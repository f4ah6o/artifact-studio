import { semanticRef } from './artifact-relationship.js';

export class SemanticEntityError extends Error {
  constructor(message, code = 'SEMANTIC_ENTITY_INVALID', details = {}) {
    super(message);
    this.name = 'SemanticEntityError';
    this.code = code;
    Object.assign(this, details);
  }
}

export class SemanticEntityResolutionError extends SemanticEntityError {
  constructor(message, details = {}) {
    super(message, 'SEMANTIC_ENTITY_RESOLUTION_CONFLICT', details);
    this.name = 'SemanticEntityResolutionError';
  }
}

function requiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new SemanticEntityError(`${field} must be a non-empty string`);
  return text;
}

function optionalText(value, field) {
  if (value == null) return undefined;
  return requiredText(value, field);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeJsonValue(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new SemanticEntityError(`${path} must contain only finite JSON numbers`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeJsonValue(item, `${path}[${index}]`));
  }
  if (isPlainObject(value)) {
    const normalized = {};
    for (const [key, item] of Object.entries(value)) {
      normalized[key] = normalizeJsonValue(item, `${path}.${key}`);
    }
    return normalized;
  }
  throw new SemanticEntityError(`${path} must be JSON-safe plain data`);
}

export function semanticEntity(value) {
  if (!isPlainObject(value)) {
    throw new SemanticEntityError('SemanticEntity must be a plain object');
  }

  const entity = {
    id: requiredText(value.id, 'SemanticEntity.id'),
    artifactId: requiredText(value.artifactId, 'SemanticEntity.artifactId'),
    kind: requiredText(value.kind, 'SemanticEntity.kind'),
  };
  const label = optionalText(value.label, 'SemanticEntity.label');
  const address = optionalText(value.address, 'SemanticEntity.address');
  if (label) entity.label = label;
  if (address) entity.address = address;
  if (value.metadata !== undefined) {
    if (!isPlainObject(value.metadata)) {
      throw new SemanticEntityError('SemanticEntity.metadata must be a plain object');
    }
    entity.metadata = normalizeJsonValue(value.metadata, 'SemanticEntity.metadata');
  }
  return Object.freeze(entity);
}

export function normalizeSemanticEntities(values, { artifactId = null } = {}) {
  if (!Array.isArray(values)) {
    throw new SemanticEntityError('SemanticEntity collection must be an array');
  }
  const expectedArtifactId = artifactId == null ? null : requiredText(artifactId, 'artifactId');
  const idsByArtifact = new Map();
  const addressesByArtifact = new Map();
  const normalized = [];

  for (const value of values) {
    const entity = semanticEntity(value);
    if (expectedArtifactId && entity.artifactId !== expectedArtifactId) {
      throw new SemanticEntityError(
        `SemanticEntity ${entity.id} belongs to unexpected artifact ${entity.artifactId}`,
        'SEMANTIC_ENTITY_ARTIFACT_MISMATCH',
        { expectedArtifactId, actualArtifactId: entity.artifactId, entityId: entity.id },
      );
    }

    if (!idsByArtifact.has(entity.artifactId)) idsByArtifact.set(entity.artifactId, new Set());
    const ids = idsByArtifact.get(entity.artifactId);
    if (ids.has(entity.id)) {
      throw new SemanticEntityError(
        `duplicate SemanticEntity id ${entity.id} in artifact ${entity.artifactId}`,
        'SEMANTIC_ENTITY_ID_DUPLICATE',
      );
    }
    ids.add(entity.id);

    if (entity.address) {
      if (!addressesByArtifact.has(entity.artifactId)) {
        addressesByArtifact.set(entity.artifactId, new Set());
      }
      const addresses = addressesByArtifact.get(entity.artifactId);
      if (addresses.has(entity.address)) {
        throw new SemanticEntityError(
          `duplicate SemanticEntity address ${entity.address} in artifact ${entity.artifactId}`,
          'SEMANTIC_ENTITY_ADDRESS_DUPLICATE',
        );
      }
      addresses.add(entity.address);
    }
    normalized.push(entity);
  }

  return Object.freeze(normalized);
}

export function resolveSemanticEntity(values, valueRef) {
  const entities = normalizeSemanticEntities(values);
  const ref = semanticRef(valueRef);
  const idMatch = ref.entityId
    ? entities.find(
        (entity) => entity.artifactId === ref.artifactId && entity.id === ref.entityId,
      ) || null
    : null;
  const addressMatch = ref.address
    ? entities.find(
        (entity) => entity.artifactId === ref.artifactId && entity.address === ref.address,
      ) || null
    : null;

  if (ref.entityId && ref.address) {
    if (idMatch && addressMatch && idMatch !== addressMatch) {
      throw new SemanticEntityResolutionError(
        `SemanticRef id ${ref.entityId} and address ${ref.address} resolve to different entities`,
        { ref, entityIdMatch: idMatch.id, addressMatch: addressMatch.id },
      );
    }
    return idMatch && addressMatch ? idMatch : null;
  }
  return idMatch || addressMatch || null;
}
