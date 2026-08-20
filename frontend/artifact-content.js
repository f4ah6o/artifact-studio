import {
  ARTIFACT_CONTENT_KINDS,
  ArtifactContentError,
  contentMatchesKind,
  normalizeArtifactContent,
  textContent,
  workspaceContent,
} from '../shared/artifact-content.js';

const ARTIFACT_CONTENT_STORAGE_KEY = 'artifact-studio:artifact-content:v1';
const LEGACY_WORKSPACE_STORAGE_KEY = 'artifact-studio:workspace:v1';

function emptyEnvelope() {
  return { version: 1, artifacts: {} };
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

function normalizeStoredEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  try {
    if (entry.content) return normalizeArtifactContent(entry.content);
    if (typeof entry.source === 'string') return textContent(entry.source);
  } catch {
    // Corrupt adapter content is ignored rather than preventing the shell from opening.
  }
  return null;
}

export function readArtifactContent(adapterId, storage = localStorage) {
  let entry = readArtifactEnvelope(storage).artifacts?.[adapterId];

  // Migration bridge: if a future/older shell already stored generic content in
  // the legacy workspace envelope, import it without coupling writes to the
  // shell's text-only in-memory snapshot.
  if (!entry) entry = parseEnvelope(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY))?.artifacts?.[adapterId];
  return normalizeStoredEntry(entry);
}

export function persistArtifactContent(adapterId, content, storage = localStorage) {
  if (!adapterId) throw new ArtifactContentError('adapter id is required');
  const normalized = normalizeArtifactContent(content);
  const envelope = readArtifactEnvelope(storage);
  envelope.artifacts[adapterId] = {
    content: normalized,
    updatedAt: new Date().toISOString(),
  };
  storage.setItem(ARTIFACT_CONTENT_STORAGE_KEY, JSON.stringify(envelope));
  return envelope.artifacts[adapterId];
}

export {
  ARTIFACT_CONTENT_KINDS,
  ARTIFACT_CONTENT_STORAGE_KEY,
  ArtifactContentError,
  contentMatchesKind,
  LEGACY_WORKSPACE_STORAGE_KEY,
  normalizeArtifactContent,
  textContent,
  workspaceContent,
};
