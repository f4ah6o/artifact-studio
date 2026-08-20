const ARTIFACT_CONTENT_STORAGE_KEY = 'artifact-studio:artifact-content:v1';
const LEGACY_WORKSPACE_STORAGE_KEY = 'artifact-studio:workspace:v1';

function emptyEnvelope() {
  return { version: 1, artifacts: {} };
}

export function textContent(source = '') {
  return { kind: 'text', source: String(source) };
}

export function workspaceContent(workspace = {}) {
  const files = workspace.files && typeof workspace.files === 'object' ? { ...workspace.files } : {};
  return {
    kind: 'workspace',
    files,
    entrypoints: Array.isArray(workspace.entrypoints) ? [...workspace.entrypoints] : [],
    activeFile: workspace.activeFile || Object.keys(files)[0] || null,
    inputFile: workspace.inputFile || null,
  };
}

function parseEnvelope(raw) {
  try {
    const parsed = JSON.parse(raw || 'null');
    if (parsed?.version === 1 && parsed.artifacts && typeof parsed.artifacts === 'object') return parsed;
  } catch {
    // Invalid browser persistence must not prevent the editor from opening.
  }
  return null;
}

export function readArtifactEnvelope(storage = localStorage) {
  return parseEnvelope(storage.getItem(ARTIFACT_CONTENT_STORAGE_KEY)) || emptyEnvelope();
}

export function readArtifactContent(adapterId, storage = localStorage) {
  let entry = readArtifactEnvelope(storage).artifacts?.[adapterId];

  // Migration bridge: if a future/older shell already stored generic content in
  // the legacy workspace envelope, import it without coupling writes to the
  // shell's text-only in-memory snapshot.
  if (!entry) entry = parseEnvelope(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY))?.artifacts?.[adapterId];
  if (!entry || typeof entry !== 'object') return null;
  if (entry.content?.kind === 'workspace' && entry.content.files && typeof entry.content.files === 'object') {
    return workspaceContent(entry.content);
  }
  if (entry.content?.kind === 'text' && typeof entry.content.source === 'string') return textContent(entry.content.source);
  if (typeof entry.source === 'string') return textContent(entry.source);
  return null;
}

export function persistArtifactContent(adapterId, content, storage = localStorage) {
  if (!adapterId || !content || !['text', 'workspace'].includes(content.kind)) throw new Error('Invalid artifact content');
  const envelope = readArtifactEnvelope(storage);
  envelope.artifacts[adapterId] = {
    content: content.kind === 'workspace' ? workspaceContent(content) : textContent(content.source),
    updatedAt: new Date().toISOString(),
  };
  storage.setItem(ARTIFACT_CONTENT_STORAGE_KEY, JSON.stringify(envelope));
  return envelope.artifacts[adapterId];
}

export { ARTIFACT_CONTENT_STORAGE_KEY, LEGACY_WORKSPACE_STORAGE_KEY };
