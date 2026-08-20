export const ARTIFACT_CONTENT_KINDS = Object.freeze(['text', 'workspace']);

export class ArtifactContentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArtifactContentError';
  }
}

function normalizeStringRecord(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArtifactContentError(`${name} must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, source]) => {
      if (!key) throw new ArtifactContentError(`${name} contains an empty key`);
      if (typeof source !== 'string') {
        throw new ArtifactContentError(`${name}.${key} must be a string`);
      }
      return [key, source];
    }),
  );
}

export function textContent(source = '') {
  return { kind: 'text', source: String(source) };
}

export function workspaceContent(workspace = {}) {
  const files = normalizeStringRecord(workspace.files || {}, 'workspace.files');
  const paths = Object.keys(files);
  const entrypoints = Array.isArray(workspace.entrypoints)
    ? [...new Set(workspace.entrypoints.map(String).filter(Boolean))]
    : [];
  const activeFile = workspace.activeFile == null ? paths[0] || null : String(workspace.activeFile);
  const inputFile = workspace.inputFile == null ? null : String(workspace.inputFile);

  if (activeFile && !Object.hasOwn(files, activeFile)) {
    throw new ArtifactContentError(`workspace.activeFile does not exist: ${activeFile}`);
  }
  if (inputFile && !Object.hasOwn(files, inputFile)) {
    throw new ArtifactContentError(`workspace.inputFile does not exist: ${inputFile}`);
  }

  return {
    kind: 'workspace',
    files,
    entrypoints,
    activeFile,
    inputFile,
  };
}

export function normalizeArtifactContent(content) {
  if (!content || typeof content !== 'object') {
    throw new ArtifactContentError('artifact content must be an object');
  }
  if (content.kind === 'text') return textContent(content.source);
  if (content.kind === 'workspace') return workspaceContent(content);
  throw new ArtifactContentError(`unsupported artifact content kind: ${String(content.kind)}`);
}

export function contentMatchesKind(content, kind) {
  if (!ARTIFACT_CONTENT_KINDS.includes(kind)) return false;
  try {
    return normalizeArtifactContent(content).kind === kind;
  } catch {
    return false;
  }
}
