import { normalizeArtifactContent } from './artifact-content.js';

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export class ArtifactTransformError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArtifactTransformError';
  }
}

function requiredIdentifier(value, name) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || !IDENTIFIER_PATTERN.test(text)) {
    throw new ArtifactTransformError(`${name} must be a stable lowercase identifier`);
  }
  return text;
}

function requiredText(value, name) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new ArtifactTransformError(`${name} is required`);
  return text;
}

function sourceAdapters(value) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = [...new Set(values.map((item) => requiredIdentifier(item, 'transform.from')))];
  if (!normalized.length) throw new ArtifactTransformError('transform.from is required');
  return Object.freeze(normalized);
}

export function defineArtifactTransform(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArtifactTransformError('transform descriptor must be an object');
  }
  if (typeof value.transform !== 'function') {
    throw new ArtifactTransformError('transform.transform must be a function');
  }

  return Object.freeze({
    id: requiredIdentifier(value.id, 'transform.id'),
    label: requiredText(value.label, 'transform.label'),
    from: sourceAdapters(value.from),
    to: requiredIdentifier(value.to, 'transform.to'),
    version: requiredText(value.version, 'transform.version'),
    transform: value.transform,
  });
}

export class ArtifactTransformRegistry {
  #transforms = new Map();

  constructor(transforms = []) {
    for (const transform of transforms) this.register(transform);
  }

  register(value) {
    const transform = defineArtifactTransform(value);
    if (this.#transforms.has(transform.id)) {
      throw new ArtifactTransformError(`duplicate transform id: ${transform.id}`);
    }
    this.#transforms.set(transform.id, transform);
    return transform;
  }

  get(id) {
    return this.#transforms.get(String(id || '')) || null;
  }

  list() {
    return [...this.#transforms.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  }

  applicableTo(adapterId) {
    const sourceAdapterId = String(adapterId || '');
    return this.list().filter((transform) => transform.from.includes(sourceAdapterId));
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((a, b) => a.localeCompare(b, 'en'))
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function artifactRevision(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new ArtifactTransformError('source artifact must be an object');
  }
  if (artifact.revision != null) {
    if (typeof artifact.revision !== 'string' || !artifact.revision.trim()) {
      throw new ArtifactTransformError('source artifact revision must be a non-empty string');
    }
    return artifact.revision;
  }

  const content = normalizeArtifactContent(artifact.content);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new ArtifactTransformError('SHA-256 runtime is unavailable');
  const canonical = JSON.stringify(stableValue(content));
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `sha256:${hex(digest)}`;
}

function frozenContent(content) {
  const normalized = normalizeArtifactContent(content);
  if (normalized.kind === 'workspace') {
    Object.freeze(normalized.files);
    Object.freeze(normalized.entrypoints);
  }
  return Object.freeze(normalized);
}

function sourceArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new ArtifactTransformError('source artifact must be an object');
  }
  const id = requiredText(artifact.id, 'source artifact id');
  const adapterId = requiredIdentifier(artifact.adapterId, 'source artifact adapterId');
  const normalized = { id, adapterId, content: frozenContent(artifact.content) };
  if (artifact.revision != null) normalized.revision = artifact.revision;
  return Object.freeze(normalized);
}

function lineageOf(derivedArtifact) {
  const lineage = derivedArtifact?.lineage;
  if (!lineage || typeof lineage !== 'object' || Array.isArray(lineage)) {
    throw new ArtifactTransformError('derived artifact lineage is required');
  }
  if (!Array.isArray(lineage.derivedFrom) || !lineage.derivedFrom.length) {
    throw new ArtifactTransformError('derived artifact lineage.derivedFrom is required');
  }
  requiredIdentifier(lineage.transform, 'lineage.transform');
  requiredText(lineage.transformVersion, 'lineage.transformVersion');
  return lineage;
}

export async function executeArtifactTransform({
  registry,
  transformId,
  artifact,
  context = {},
  derivedArtifactId,
}) {
  if (!(registry instanceof ArtifactTransformRegistry)) {
    throw new ArtifactTransformError('transform registry is required');
  }
  const transform = registry.get(transformId);
  if (!transform) throw new ArtifactTransformError(`unknown transform: ${String(transformId)}`);

  const source = sourceArtifact(artifact);
  if (!transform.from.includes(source.adapterId)) {
    throw new ArtifactTransformError(
      `transform ${transform.id} does not accept source adapter: ${source.adapterId}`,
    );
  }

  const revision = await artifactRevision(source);
  const content = normalizeArtifactContent(await transform.transform(source, context));
  const derived = {
    adapterId: transform.to,
    content,
    lineage: {
      derivedFrom: [{ artifactId: source.id, revision }],
      transform: transform.id,
      transformVersion: transform.version,
    },
  };
  if (derivedArtifactId != null) {
    derived.id = requiredText(derivedArtifactId, 'derived artifact id');
  }
  return derived;
}

export async function derivedArtifactStatus(derivedArtifact, currentSources) {
  const lineage = lineageOf(derivedArtifact);
  const sources = Array.isArray(currentSources) ? currentSources : [currentSources];
  const byId = new Map();
  for (const artifact of sources) {
    const source = sourceArtifact(artifact);
    if (byId.has(source.id)) {
      throw new ArtifactTransformError(`duplicate current source artifact id: ${source.id}`);
    }
    byId.set(source.id, source);
  }

  for (const record of lineage.derivedFrom) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new ArtifactTransformError('lineage source must be an object');
    }
    const artifactId = requiredText(record.artifactId, 'lineage source artifactId');
    const recordedRevision = requiredText(record.revision, 'lineage source revision');
    const current = byId.get(artifactId);
    if (!current)
      throw new ArtifactTransformError(`current source artifact is missing: ${artifactId}`);
    if ((await artifactRevision(current)) !== recordedRevision) return 'stale';
  }
  return 'current';
}

export async function regenerateDerivedArtifact({
  registry,
  derivedArtifact,
  artifact,
  context = {},
}) {
  const lineage = lineageOf(derivedArtifact);
  if (lineage.derivedFrom.length !== 1) {
    throw new ArtifactTransformError('regeneration currently requires exactly one source artifact');
  }
  const source = sourceArtifact(artifact);
  const expectedSourceId = requiredText(
    lineage.derivedFrom[0].artifactId,
    'lineage source artifactId',
  );
  if (source.id !== expectedSourceId) {
    throw new ArtifactTransformError(
      `regeneration source mismatch: expected ${expectedSourceId}, received ${source.id}`,
    );
  }

  return executeArtifactTransform({
    registry,
    transformId: lineage.transform,
    artifact: source,
    context,
    derivedArtifactId: derivedArtifact.id,
  });
}
