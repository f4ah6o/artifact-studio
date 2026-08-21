import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { normalizeGraphProjection } from '../core/graph-projection.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export class DaguSourceError extends Error {
  constructor(message, code = 'DAGU_SOURCE_INVALID') {
    super(message);
    this.name = 'DaguSourceError';
    this.code = code;
  }
}

export class DaguCliError extends Error {
  constructor(
    message,
    { code = 'DAGU_CLI_FAILED', exitCode = null, stdout = '', stderr = '' } = {},
  ) {
    super(message);
    this.name = 'DaguCliError';
    this.code = code;
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

function sourceText(source) {
  if (typeof source !== 'string') throw new DaguSourceError('Dagu source must be text');
  if (Buffer.byteLength(source) > MAX_SOURCE_BYTES) {
    throw new DaguSourceError(
      `Dagu source exceeds ${MAX_SOURCE_BYTES} bytes`,
      'DAGU_SOURCE_TOO_LARGE',
    );
  }
  return source;
}

function indentation(line) {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function stripYamlComment(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === "'" && value[index + 1] === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index);
    }
  }
  return value;
}

function yamlScalar(raw) {
  const value = stripYamlComment(String(raw || '')).trim();
  if (!value) return '';
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return String(JSON.parse(value));
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function splitFlowList(source) {
  const values = [];
  let quote = null;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === "'" && source[index + 1] === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ',') {
      values.push(source.slice(start, index));
      start = index + 1;
    }
  }
  values.push(source.slice(start));
  return values;
}

function dependsValues(raw) {
  const value = stripYamlComment(String(raw || '')).trim();
  if (!value) return [];
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitFlowList(value.slice(1, -1)).map(yamlScalar).filter(Boolean);
  }
  return [yamlScalar(value)].filter(Boolean);
}

function mappingLine(text) {
  const match = text.match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
  if (!match) return null;
  return { key: match[1], value: match[2] || '' };
}

function splitYamlDocuments(source) {
  const documents = [[]];
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^---(?:\s+#.*)?\s*$/.test(line)) documents.push([]);
    else documents.at(-1).push(line);
  }
  return documents;
}

function stepEntries(documentLines) {
  const stepsIndex = documentLines.findIndex((line) => /^steps:\s*(?:#.*)?$/.test(line));
  if (stepsIndex < 0) return [];
  const stepsIndent = indentation(documentLines[stepsIndex]);
  if (stepsIndent !== 0) return [];

  const entries = [];
  let listIndent = null;
  let current = null;

  const finish = () => {
    if (current) entries.push(current);
    current = null;
  };

  for (let index = stepsIndex + 1; index < documentLines.length; index += 1) {
    const line = documentLines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      if (current) current.lines.push({ index, indent: indentation(line), text: trimmed });
      continue;
    }

    const indent = indentation(line);
    if (indent <= stepsIndent) break;
    const item = line.slice(indent).match(/^-\s*(.*)$/);

    if (listIndent == null) {
      if (!item) continue;
      listIndent = indent;
      current = { inline: item[1], lines: [], listIndent };
      continue;
    }

    if (indent === listIndent && item) {
      finish();
      current = { inline: item[1], lines: [], listIndent };
      continue;
    }

    if (current) current.lines.push({ index, indent, text: line.slice(indent) });
  }

  finish();
  return entries;
}

function parseStepEntry(entry, index) {
  const direct = [];
  const inlineMapping = mappingLine(entry.inline);
  if (inlineMapping) direct.push({ ...inlineMapping, inline: true, lineIndex: -1 });

  const candidateIndents = entry.lines
    .filter((line) => line.indent > entry.listIndent && mappingLine(line.text))
    .map((line) => line.indent);
  const directIndent = candidateIndents.length ? Math.min(...candidateIndents) : null;

  if (directIndent != null) {
    for (const line of entry.lines) {
      if (line.indent !== directIndent) continue;
      const mapping = mappingLine(line.text);
      if (mapping) direct.push({ ...mapping, inline: false, lineIndex: line.index });
    }
  }

  let id = '';
  let name = '';
  const depends = [];

  for (const record of direct) {
    if (record.key === 'id') id = yamlScalar(record.value);
    if (record.key === 'name') name = yamlScalar(record.value);
    if (record.key !== 'depends') continue;

    depends.push(...dependsValues(record.value));
    if (record.value.trim() || directIndent == null || record.inline) continue;

    const physicalIndex = entry.lines.findIndex((line) => line.index === record.lineIndex);
    for (let offset = physicalIndex + 1; offset < entry.lines.length; offset += 1) {
      const line = entry.lines[offset];
      if (!line.text || line.text.startsWith('#')) continue;
      if (line.indent <= directIndent) break;
      const item = line.text.match(/^-\s*(.*)$/);
      if (item) {
        const value = yamlScalar(item[1]);
        if (value) depends.push(value);
      }
    }
  }

  return {
    id,
    name,
    depends: [...new Set(depends)],
    index,
  };
}

export function parseDaguStructure(source) {
  const text = sourceText(source);
  return splitYamlDocuments(text).map((lines, documentIndex) => ({
    documentIndex,
    steps: stepEntries(lines).map(parseStepEntry),
  }));
}

function graphNodeId(documentIndex, step) {
  const identity = step.id || step.name;
  return identity
    ? `dagu:${documentIndex}:step:${encodeURIComponent(identity)}`
    : `dagu:${documentIndex}:anonymous:${step.index}`;
}

function requiredDaguArtifactId(artifactId) {
  const value = typeof artifactId === 'string' && artifactId.trim() ? artifactId.trim() : null;
  if (!value) throw new DaguSourceError('artifactId must be a non-empty string');
  return value;
}

function daguSemanticAddress(documentIndex, identity) {
  return `document:${documentIndex}#step:${identity}`;
}

function daguSemanticModel(source, artifactId) {
  const normalizedArtifactId = requiredDaguArtifactId(artifactId);
  const documents = parseDaguStructure(source);
  const entities = [];
  const relationships = [];

  for (const document of documents) {
    const aliases = new Map();
    const ambiguousAliases = new Set();
    const entityByNodeId = new Map();
    const stepEntities = [];

    for (const step of document.steps) {
      const identity = step.id || step.name;
      if (!identity) continue;
      const nodeId = graphNodeId(document.documentIndex, step);
      if (entityByNodeId.has(nodeId)) {
        throw new DaguSourceError(
          `duplicate Dagu semantic step identity: ${identity}`,
          'DAGU_SEMANTIC_ID_DUPLICATE',
        );
      }
      const entity = {
        id: nodeId,
        artifactId: normalizedArtifactId,
        kind: 'step',
        label: step.name || step.id,
        address: daguSemanticAddress(document.documentIndex, identity),
        metadata: {
          documentIndex: document.documentIndex,
          stepIndex: step.index,
          id: step.id || null,
          name: step.name || null,
          depends: [...step.depends],
        },
      };
      entities.push(entity);
      entityByNodeId.set(nodeId, entity);
      stepEntities.push({ step, entity });

      for (const alias of [step.id, step.name].filter(Boolean)) {
        if (aliases.has(alias) && aliases.get(alias) !== nodeId) ambiguousAliases.add(alias);
        else aliases.set(alias, nodeId);
      }
    }

    for (const { step, entity: sourceEntity } of stepEntities) {
      for (const dependency of step.depends) {
        if (ambiguousAliases.has(dependency)) continue;
        const targetNodeId = aliases.get(dependency);
        const targetEntity = targetNodeId ? entityByNodeId.get(targetNodeId) : null;
        if (!targetEntity) continue;
        relationships.push({
          id: `dagu:discovered:${encodeURIComponent(normalizedArtifactId)}:${encodeURIComponent(sourceEntity.id)}:${encodeURIComponent(targetEntity.id)}`,
          type: 'depends-on',
          from: {
            artifactId: normalizedArtifactId,
            entityId: sourceEntity.id,
            address: sourceEntity.address,
          },
          to: {
            artifactId: normalizedArtifactId,
            entityId: targetEntity.id,
            address: targetEntity.address,
          },
          provenance: 'discovered',
        });
      }
    }
  }

  entities.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  relationships.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return { entities, relationships };
}

export function daguSemanticEntities(source, artifactId) {
  return daguSemanticModel(source, artifactId).entities;
}

export function daguDiscoveredRelationships(source, artifactId) {
  return daguSemanticModel(source, artifactId).relationships;
}

export function daguGraphProjection(source) {
  const documents = parseDaguStructure(source);
  const nodes = [];
  const edges = [];

  for (const document of documents) {
    const aliases = new Map();
    const ambiguous = new Set();
    const stepNodes = document.steps.map((step) => {
      const node = {
        id: graphNodeId(document.documentIndex, step),
        label: step.name || step.id || `Step ${step.index + 1}`,
        kind: 'step',
      };
      for (const alias of [step.id, step.name].filter(Boolean)) {
        if (aliases.has(alias) && aliases.get(alias) !== node.id) ambiguous.add(alias);
        else aliases.set(alias, node.id);
      }
      return { step, node };
    });

    nodes.push(...stepNodes.map(({ node }) => node));
    for (const { step, node } of stepNodes) {
      for (const dependency of step.depends) {
        const from = ambiguous.has(dependency)
          ? `dagu:${document.documentIndex}:ambiguous:${encodeURIComponent(dependency)}`
          : aliases.get(dependency) ||
            `dagu:${document.documentIndex}:missing:${encodeURIComponent(dependency)}`;
        edges.push({ from, to: node.id, kind: 'depends-on' });
      }
    }
  }

  return normalizeGraphProjection({ nodes, edges });
}

function safeChildEnv(overrides = {}) {
  const names = ['PATH', 'LANG', 'LC_ALL', 'SystemRoot', 'WINDIR', 'PATHEXT'];
  const env = {};
  for (const name of names) if (process.env[name] != null) env[name] = process.env[name];
  return { ...env, ...overrides };
}

export function daguBinary() {
  return process.env.DAGU_BINARY || 'dagu';
}

export function runDagu(
  args,
  { timeoutMs = DEFAULT_TIMEOUT_MS, allowFailure = false, cwd, env = {} } = {},
) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    throw new TypeError('Dagu argv must be an array of strings');
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(daguBinary(), args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: safeChildEnv(env),
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
          new DaguCliError(`Dagu ${stream} exceeded ${MAX_OUTPUT_BYTES} bytes`, {
            code: 'DAGU_OUTPUT_LIMIT',
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
          new DaguCliError(`Dagu executable not found: ${daguBinary()}`, {
            code: 'DAGU_UNAVAILABLE',
          }),
        );
      } else {
        finishError(
          new DaguCliError(`Failed to start Dagu: ${error.message}`, {
            code: 'DAGU_START_FAILED',
          }),
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
          new DaguCliError(`Dagu command timed out after ${timeoutMs}ms`, {
            code: 'DAGU_TIMEOUT',
            ...result,
          }),
        );
      } else if (exitCode !== 0 && !allowFailure) {
        rejectPromise(new DaguCliError(`Dagu command exited with code ${exitCode}`, { ...result }));
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

async function materializeDagu(source, callback) {
  const text = sourceText(source);
  const root = await mkdtemp(join(tmpdir(), 'as-code-studio-dagu-'));
  const workflowPath = join(root, 'workflow.yaml');
  try {
    await writeFile(workflowPath, text, { encoding: 'utf8', flag: 'wx' });
    const isolatedEnv = {
      HOME: root,
      XDG_CONFIG_HOME: join(root, 'config'),
      XDG_CACHE_HOME: join(root, 'cache'),
      XDG_DATA_HOME: join(root, 'data'),
      DAGU_SKIP_EXAMPLES: 'true',
    };
    return await callback({ root, workflowPath, isolatedEnv });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

function stripAnsi(value) {
  return value.replace(ANSI_ESCAPE, '');
}

export function mapDaguValidationOutput(result, workflowPath = 'workflow.yaml') {
  const fileName = basename(workflowPath);
  const combined = stripAnsi([result?.stderr, result?.stdout].filter(Boolean).join('\n'))
    .replaceAll(workflowPath, fileName)
    .trim();
  const lines = combined
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const unique = [...new Set(lines)];
  if (!unique.length) {
    return [
      {
        severity: 'error',
        code: 'dagu_validation_error',
        message: `Dagu validation failed with exit code ${result?.exitCode ?? 'unknown'}`,
      },
    ];
  }

  return unique.map((line) => {
    const location = line.match(/(?:^|\s)([^\s:]+\.ya?ml):(\d+)(?::(\d+))?:\s*(.*)$/i);
    if (!location) {
      return { severity: 'error', code: 'dagu_validation_error', message: line };
    }
    return {
      severity: 'error',
      file: basename(location[1]),
      line: Number(location[2]),
      column: location[3] ? Number(location[3]) : undefined,
      code: 'dagu_validation_error',
      message: location[4] || 'Dagu validation error',
    };
  });
}

export async function validateDaguSource(source) {
  return materializeDagu(source, async ({ root, workflowPath, isolatedEnv }) => {
    const result = await runDagu(['validate', workflowPath], {
      cwd: root,
      env: isolatedEnv,
      allowFailure: true,
    });
    if (result.exitCode === 0) return { ok: true, findings: [] };
    return { ok: false, findings: mapDaguValidationOutput(result, workflowPath) };
  });
}

export async function daguRuntimeCapabilities() {
  try {
    const result = await runDagu(['version'], { timeoutMs: 3_000, allowFailure: true });
    const version = stripAnsi(result.stdout || result.stderr || '').trim() || null;
    return {
      validate: {
        available: result.exitCode === 0,
        reason: result.exitCode === 0 ? null : 'DAGU_VERSION_FAILED',
      },
      project: { available: true, reason: null },
      version,
    };
  } catch (error) {
    if (error instanceof DaguCliError) {
      return {
        validate: { available: false, reason: error.code },
        project: { available: true, reason: null },
        version: null,
      };
    }
    throw error;
  }
}
