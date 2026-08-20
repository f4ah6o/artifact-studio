import {
  ARTIFACT_CONTENT_KINDS,
  ArtifactContentError,
  contentMatchesKind,
  normalizeArtifactContent,
  textContent,
  workspaceContent,
} from '../core/artifact-content.js';

const ARTIFACT_CONTENT_STORAGE_KEY = 'artifact-studio:artifact-content:v1';
const LEGACY_WORKSPACE_STORAGE_KEY = 'artifact-studio:workspace:v1';

function emptyEnvelope() {
  return { version: 1, artifacts: {} };
}

function parseEnvelope(raw) {
  try {
    const parsed = JSON.parse(raw || 'null');
    if (parsed?.version === 1 && parsed.artifacts && typeof parsed.artifacts === 'object')
      return parsed;
  } catch {
    // Invalid browser persistence must not prevent the editor from opening.
  }
  return null;
}

function artifactId(adapterId) {
  return `artifact:${adapterId}`;
}

function normalizeStoredContent(entry) {
  if (!entry || typeof entry !== 'object') return null;
  try {
    if (entry.content) return normalizeArtifactContent(entry.content);
    if (typeof entry.source === 'string') return textContent(entry.source);
  } catch {
    // Corrupt adapter content is ignored rather than preventing the shell from opening.
  }
  return null;
}

function normalizeStoredRecord(adapterId, entry) {
  const content = normalizeStoredContent(entry);
  if (!content) return null;
  const id = typeof entry?.id === 'string' && entry.id.trim() ? entry.id : artifactId(adapterId);
  const record = { id, adapterId, content };
  if (typeof entry?.revision === 'string' && entry.revision.trim())
    record.revision = entry.revision;
  if (entry?.lineage && typeof entry.lineage === 'object' && !Array.isArray(entry.lineage)) {
    record.lineage = entry.lineage;
  }
  return record;
}

export function readArtifactEnvelope(storage = localStorage) {
  return parseEnvelope(storage.getItem(ARTIFACT_CONTENT_STORAGE_KEY)) || emptyEnvelope();
}

export function readArtifactRecord(adapterId, storage = localStorage) {
  const id = String(adapterId || '');
  if (!id) return null;
  let entry = readArtifactEnvelope(storage).artifacts?.[id];

  // Migration bridge: import generic content from the legacy shell envelope
  // without changing its v1/latest-per-adapter persistence contract.
  if (!entry) entry = parseEnvelope(storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY))?.artifacts?.[id];
  return normalizeStoredRecord(id, entry);
}

export function readArtifactContent(adapterId, storage = localStorage) {
  return readArtifactRecord(adapterId, storage)?.content || null;
}

export function persistArtifactRecord(artifact, storage = localStorage) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new ArtifactContentError('artifact record is required');
  }
  const adapterId = typeof artifact.adapterId === 'string' ? artifact.adapterId.trim() : '';
  if (!adapterId) throw new ArtifactContentError('adapter id is required');
  const content = normalizeArtifactContent(artifact.content);
  const id =
    typeof artifact.id === 'string' && artifact.id.trim() ? artifact.id : artifactId(adapterId);
  const envelope = readArtifactEnvelope(storage);
  const entry = {
    id,
    content,
    updatedAt: new Date().toISOString(),
  };
  if (typeof artifact.revision === 'string' && artifact.revision.trim())
    entry.revision = artifact.revision;
  if (
    artifact.lineage &&
    typeof artifact.lineage === 'object' &&
    !Array.isArray(artifact.lineage)
  ) {
    entry.lineage = artifact.lineage;
  }
  envelope.artifacts[adapterId] = entry;
  storage.setItem(ARTIFACT_CONTENT_STORAGE_KEY, JSON.stringify(envelope));
  return normalizeStoredRecord(adapterId, entry);
}

export function persistArtifactContent(adapterId, content, storage = localStorage) {
  if (!adapterId) throw new ArtifactContentError('adapter id is required');
  const existing = readArtifactRecord(adapterId, storage);
  return persistArtifactRecord(
    {
      ...(existing || { id: artifactId(adapterId), adapterId }),
      content,
    },
    storage,
  );
}

export function currentArtifactRecord(adapterId, content, storage = localStorage) {
  const existing = readArtifactRecord(adapterId, storage);
  return {
    ...(existing || { id: artifactId(adapterId), adapterId }),
    adapterId,
    content: normalizeArtifactContent(content),
  };
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
