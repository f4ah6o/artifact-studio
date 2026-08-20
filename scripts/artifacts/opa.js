import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { normalizeGraphProjection } from '../../shared/graph-projection.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 128;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_WORKSPACE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.rego', '.json', '.yaml', '.yml']);
const ALLOWED_EXPLAIN = new Set(['notes', 'fails', 'full', 'debug']);

export class OpaWorkspaceError extends Error {
  constructor(message, code = 'OPA_WORKSPACE_INVALID') {
    super(message);
    this.name = 'OpaWorkspaceError';
    this.code = code;
  }
}

export class OpaCliError extends Error {
  constructor(
    message,
    { code = 'OPA_CLI_FAILED', exitCode = null, stdout = '', stderr = '' } = {},
  ) {
    super(message);
    this.name = 'OpaCliError';
    this.code = code;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function validateWorkspacePath(path) {
  if (typeof path !== 'string' || !path.trim())
    throw new OpaWorkspaceError('Workspace file path must be a non-empty string');
  if (path.includes('\0'))
    throw new OpaWorkspaceError(`Workspace path contains NUL: ${JSON.stringify(path)}`);
  if (path.includes('\\'))
    throw new OpaWorkspaceError(`Workspace path must use forward slashes: ${path}`);
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.startsWith('/'))
    throw new OpaWorkspaceError(`Absolute workspace paths are not allowed: ${path}`);
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..'))
    throw new OpaWorkspaceError(`Unsafe workspace path: ${path}`);
  if (parts.some((part) => part.length > 255))
    throw new OpaWorkspaceError(`Workspace path segment is too long: ${path}`);
  if (path.length > 1024) throw new OpaWorkspaceError(`Workspace path is too long: ${path}`);
  const extension = extname(path).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension))
    throw new OpaWorkspaceError(`Unsupported OPA workspace file type: ${path}`);
  return path;
}

function assertWorkspaceReference(value, name, files) {
  if (value == null) return null;
  const path = validateWorkspacePath(value);
  if (!Object.hasOwn(files, path))
    throw new OpaWorkspaceError(`${name} does not exist in workspace: ${path}`);
  return path;
}

export function normalizeWorkspace(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OpaWorkspaceError('workspace must be an object');
  const rawFiles = value.files;
  if (!rawFiles || typeof rawFiles !== 'object' || Array.isArray(rawFiles))
    throw new OpaWorkspaceError('workspace.files must be an object');

  const entries = Object.entries(rawFiles);
  if (!entries.length) throw new OpaWorkspaceError('workspace must contain at least one file');
  if (entries.length > MAX_FILES)
    throw new OpaWorkspaceError(`workspace exceeds ${MAX_FILES} files`);

  const files = {};
  let totalBytes = 0;
  for (const [rawPath, source] of entries) {
    const path = validateWorkspacePath(rawPath);
    if (typeof source !== 'string')
      throw new OpaWorkspaceError(`Workspace file must be text: ${path}`);
    const bytes = Buffer.byteLength(source);
    if (bytes > MAX_FILE_BYTES)
      throw new OpaWorkspaceError(`Workspace file exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
    totalBytes += bytes;
    if (totalBytes > MAX_WORKSPACE_BYTES)
      throw new OpaWorkspaceError(`workspace exceeds ${MAX_WORKSPACE_BYTES} bytes`);
    if (extname(path).toLowerCase() === '.json') {
      try {
        JSON.parse(source);
      } catch (error) {
        throw new OpaWorkspaceError(`Invalid JSON in ${path}: ${error.message}`);
      }
    }
    files[path] = source;
  }

  const entrypoints =
    value.entrypoints == null
      ? []
      : Array.isArray(value.entrypoints)
        ? value.entrypoints.map((entry, index) => {
            if (typeof entry !== 'string' || !entry.trim() || entry.length > 2048) {
              throw new OpaWorkspaceError(`entrypoints[${index}] must be a non-empty query string`);
            }
            return entry.trim();
          })
        : (() => {
            throw new OpaWorkspaceError('entrypoints must be an array');
          })();

  return {
    files,
    entrypoints: [...new Set(entrypoints)],
    activeFile:
      assertWorkspaceReference(value.activeFile, 'activeFile', files) || Object.keys(files)[0],
    inputFile: assertWorkspaceReference(value.inputFile, 'inputFile', files),
  };
}

function safeAbsolutePath(root, relativePath) {
  const candidate = resolve(root, ...relativePath.split('/'));
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new OpaWorkspaceError(`Unsafe workspace path: ${relativePath}`);
  }
  return candidate;
}

function safeChildEnv() {
  const names = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
    'SystemRoot',
    'WINDIR',
    'PATHEXT',
  ];
  const env = {};
  for (const name of names) if (process.env[name] != null) env[name] = process.env[name];
  return env;
}

export function opaBinary() {
  return process.env.OPA_BINARY || 'opa';
}

export function runOpa(args, { timeoutMs = DEFAULT_TIMEOUT_MS, allowFailure = false, cwd } = {}) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    throw new TypeError('OPA argv must be an array of strings');
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(opaBinary(), args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: safeChildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timedOut = false;

    const finishError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(error);
    };

    const append = (current, chunk, stream) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finishError(
          new OpaCliError(`OPA ${stream} exceeded ${MAX_OUTPUT_BYTES} bytes`, {
            code: 'OPA_OUTPUT_LIMIT',
          }),
        );
        return current;
      }
      return next;
    };

    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk, 'stdout');
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk, 'stderr');
    });
    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        finishError(
          new OpaCliError(`OPA executable not found: ${opaBinary()}`, { code: 'OPA_UNAVAILABLE' }),
        );
      } else {
        finishError(
          new OpaCliError(`Failed to start OPA: ${error.message}`, { code: 'OPA_START_FAILED' }),
        );
      }
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = {
        exitCode,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
      };
      if (timedOut) {
        rejectPromise(
          new OpaCliError(`OPA command timed out after ${timeoutMs}ms`, {
            code: 'OPA_TIMEOUT',
            ...result,
          }),
        );
      } else if (exitCode !== 0 && !allowFailure) {
        rejectPromise(new OpaCliError(`OPA command exited with code ${exitCode}`, { ...result }));
      } else {
        resolvePromise(result);
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref?.();
  });
}

let currentCapabilitiesPromise = null;
async function currentCapabilities() {
  if (!currentCapabilitiesPromise) {
    currentCapabilitiesPromise = runOpa(['capabilities', '--current'])
      .then(({ stdout }) => {
        const value = JSON.parse(stdout);
        value.allow_net = [];
        return value;
      })
      .catch((error) => {
        currentCapabilitiesPromise = null;
        throw error;
      });
  }
  return currentCapabilitiesPromise;
}

async function materialize(workspaceValue, callback) {
  const workspace = normalizeWorkspace(workspaceValue);
  const root = await mkdtemp(join(tmpdir(), 'artifact-studio-opa-'));
  const workspaceDir = join(root, 'workspace');
  try {
    await mkdir(workspaceDir, { recursive: true });
    for (const [path, source] of Object.entries(workspace.files)) {
      const target = safeAbsolutePath(workspaceDir, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source, { encoding: 'utf8', flag: 'wx' });
    }
    const capabilitiesPath = join(root, 'capabilities.json');
    const capabilities = await currentCapabilities();
    await writeFile(capabilitiesPath, `${JSON.stringify(capabilities)}\n`, 'utf8');
    return await callback({
      root,
      workspaceDir,
      capabilitiesPath,
      workspace,
      pathFor: (path) => safeAbsolutePath(workspaceDir, path),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function parseJsonOutput(text, label) {
  try {
    return JSON.parse(text || '{}');
  } catch (error) {
    throw new OpaCliError(`OPA ${label} returned invalid JSON: ${error.message}`, {
      code: 'OPA_INVALID_OUTPUT',
      stdout: text,
    });
  }
}

function locationFrom(error) {
  const location = error?.location || error?.details?.location || null;
  if (!location || typeof location !== 'object') return {};
  return {
    line: Number.isInteger(location.row) ? location.row : undefined,
    column: Number.isInteger(location.col) ? location.col : undefined,
  };
}

export function mapOpaErrors(payload, workspaceDir = '') {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  return errors.map((error) => {
    let file = error?.location?.file || error?.file;
    if (typeof file === 'string' && workspaceDir) {
      const rel = relative(workspaceDir, file);
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) file = rel.split(sep).join('/');
    }
    return {
      severity: 'error',
      file: typeof file === 'string' ? file : undefined,
      ...locationFrom(error),
      code: typeof error?.code === 'string' ? error.code : undefined,
      message: String(error?.message || error?.text || error?.code || 'OPA validation error'),
    };
  });
}

function fallbackFinding(result) {
  const message = (
    result.stderr ||
    result.stdout ||
    `OPA exited with code ${result.exitCode}`
  ).trim();
  return [{ severity: 'error', message: message || 'OPA validation failed' }];
}

function dataPaths(context) {
  return Object.keys(context.workspace.files)
    .filter((path) => path !== context.workspace.inputFile)
    .map((path) => context.pathFor(path));
}

function dataArgs(context) {
  return dataPaths(context).flatMap((path) => ['--data', path]);
}

export async function checkWorkspace(workspace) {
  return materialize(workspace, async (context) => {
    const result = await runOpa(
      ['check', '--format=json', '--capabilities', context.capabilitiesPath, context.workspaceDir],
      { allowFailure: true },
    );
    if (result.exitCode === 0) return { ok: true, findings: [] };
    let payload = null;
    try {
      payload = JSON.parse(result.stdout || result.stderr);
    } catch {
      /* use fallback */
    }
    const findings = payload
      ? mapOpaErrors(payload, context.workspaceDir)
      : fallbackFinding(result);
    return { ok: false, findings };
  });
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = stableJson(value[key]);
    return output;
  }
  return value;
}

export function formatJsonSource(source) {
  return `${JSON.stringify(stableJson(JSON.parse(source)), null, 2)}\n`;
}

export async function formatWorkspace(workspace) {
  return materialize(workspace, async (context) => {
    const files = { ...context.workspace.files };
    for (const path of Object.keys(files)) {
      const extension = extname(path).toLowerCase();
      if (extension === '.rego') {
        const result = await runOpa([
          'fmt',
          '--check-result',
          '--capabilities',
          context.capabilitiesPath,
          context.pathFor(path),
        ]);
        files[path] = result.stdout;
      } else if (extension === '.json') {
        files[path] = formatJsonSource(files[path]);
      }
    }
    return { ...context.workspace, files };
  });
}

function validateQuery(query) {
  if (typeof query !== 'string' || !query.trim())
    throw new OpaWorkspaceError('query must be a non-empty string', 'OPA_QUERY_INVALID');
  if (query.length > 2048 || /[\0\r\n]/.test(query))
    throw new OpaWorkspaceError(
      'query is too long or contains control characters',
      'OPA_QUERY_INVALID',
    );
  return query.trim();
}

export async function evaluateWorkspace(workspace, query, { input, explain = 'notes' } = {}) {
  const safeQuery = validateQuery(query);
  const explainMode = ALLOWED_EXPLAIN.has(explain) ? explain : 'notes';
  return materialize(workspace, async (context) => {
    let inputPath = context.workspace.inputFile
      ? context.pathFor(context.workspace.inputFile)
      : null;
    if (input !== undefined) {
      inputPath = join(context.root, 'input.json');
      await writeFile(inputPath, `${JSON.stringify(input)}\n`, 'utf8');
    }

    const args = [
      'eval',
      safeQuery,
      '--format=json',
      `--explain=${explainMode}`,
      '--capabilities',
      context.capabilitiesPath,
      ...dataArgs(context),
    ];
    if (inputPath) args.push('--input', inputPath);
    const result = await runOpa(args);
    return parseJsonOutput(result.stdout, 'eval');
  });
}

export async function testWorkspace(workspace) {
  return materialize(workspace, async (context) => {
    const paths = dataPaths(context);
    if (!paths.some((path) => path.endsWith('.rego')))
      throw new OpaWorkspaceError('workspace contains no Rego files');
    const common = [
      '--format=json',
      '--capabilities',
      context.capabilitiesPath,
      '--timeout',
      '5s',
      ...paths,
    ];
    const testsResult = await runOpa(['test', ...common], {
      allowFailure: true,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    const coverageResult = await runOpa(['test', '--coverage', ...common], {
      allowFailure: true,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    return {
      ok: testsResult.exitCode === 0,
      exitCode: testsResult.exitCode,
      tests: parseJsonOutput(testsResult.stdout || '[]', 'test'),
      coverage: parseJsonOutput(coverageResult.stdout || '{}', 'test coverage'),
      stderr: testsResult.stderr || coverageResult.stderr || '',
    };
  });
}

function refPartText(part) {
  if (part && typeof part === 'object' && 'value' in part) return String(part.value);
  return String(part);
}

function refText(value) {
  if (Array.isArray(value)) return value.map(refPartText).join('.');
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'value' in value) return String(value.value);
  return JSON.stringify(value);
}

export function dependencyProjection(payload, query) {
  const base = Array.isArray(payload?.base)
    ? payload.base
    : Array.isArray(payload?.base_documents)
      ? payload.base_documents
      : [];
  const virtual = Array.isArray(payload?.virtual)
    ? payload.virtual
    : Array.isArray(payload?.virtual_documents)
      ? payload.virtual_documents
      : [];
  const refs = [
    ...base.map((value) => ({ value: refText(value), kind: 'base' })),
    ...virtual.map((value) => ({ value: refText(value), kind: 'virtual' })),
  ].filter((entry) => entry.value && entry.value !== query);
  const unique = [
    ...new Map(refs.map((entry) => [`${entry.kind}:${entry.value}`, entry])).values(),
  ];
  return normalizeGraphProjection({
    nodes: [
      { id: 'query', label: query, kind: 'query' },
      ...unique.map((entry, index) => ({
        id: `dependency-${index}`,
        label: entry.value,
        kind: entry.kind,
      })),
    ],
    edges: unique.map((_, index) => ({
      from: 'query',
      to: `dependency-${index}`,
      kind: 'depends-on',
    })),
  });
}

export async function dependenciesWorkspace(workspace, query) {
  const safeQuery = validateQuery(query);
  return materialize(workspace, async (context) => {
    const result = await runOpa(['deps', safeQuery, '--format=json', ...dataArgs(context)]);
    const dependencies = parseJsonOutput(result.stdout, 'deps');
    return { dependencies, graph: dependencyProjection(dependencies, safeQuery) };
  });
}

export async function readWorkspaceInput(workspace) {
  return materialize(workspace, async (context) => {
    if (!context.workspace.inputFile) return null;
    const extension = extname(context.workspace.inputFile).toLowerCase();
    if (extension !== '.json')
      throw new OpaWorkspaceError('Reading input in the UI currently requires a JSON inputFile');
    return JSON.parse(await readFile(context.pathFor(context.workspace.inputFile), 'utf8'));
  });
}
