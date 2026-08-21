export const ARTIFACT_RELATIONSHIP_PROVENANCE = Object.freeze([
  'declared',
  'discovered',
  'generated',
]);

export class ArtifactRelationshipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArtifactRelationshipError';
  }
}

function requiredText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new ArtifactRelationshipError(`${field} must be a non-empty string`);
  return text;
}

function optionalText(value, field) {
  if (value == null) return undefined;
  return requiredText(value, field);
}

export function semanticRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArtifactRelationshipError('SemanticRef must be an object');
  }
  const ref = { artifactId: requiredText(value.artifactId, 'SemanticRef.artifactId') };
  const entityId = optionalText(value.entityId, 'SemanticRef.entityId');
  const address = optionalText(value.address, 'SemanticRef.address');
  if (entityId) ref.entityId = entityId;
  if (address) ref.address = address;
  return Object.freeze(ref);
}

export function artifactRelationship(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArtifactRelationshipError('ArtifactRelationship must be an object');
  }
  const provenance = requiredText(value.provenance, 'ArtifactRelationship.provenance');
  if (!ARTIFACT_RELATIONSHIP_PROVENANCE.includes(provenance)) {
    throw new ArtifactRelationshipError(`unsupported relationship provenance: ${provenance}`);
  }
  return Object.freeze({
    id: requiredText(value.id, 'ArtifactRelationship.id'),
    type: requiredText(value.type, 'ArtifactRelationship.type'),
    from: semanticRef(value.from),
    to: semanticRef(value.to),
    provenance,
  });
}

export function normalizeArtifactRelationships(values) {
  const relationships = Array.isArray(values) ? values : Object.values(values || {});
  const result = {};
  for (const value of relationships) {
    const relationship = artifactRelationship(value);
    if (result[relationship.id]) {
      throw new ArtifactRelationshipError(`duplicate relationship id: ${relationship.id}`);
    }
    result[relationship.id] = relationship;
  }
  return result;
}

export async function validateArtifactRelationshipReferences(
  values,
  { artifacts = {}, resolveEntity = null } = {},
) {
  const relationships = normalizeArtifactRelationships(values);
  const artifactMap =
    artifacts instanceof Map ? artifacts : new Map(Object.entries(artifacts || {}));
  const findings = [];

  for (const relationship of Object.values(relationships)) {
    for (const endpoint of ['from', 'to']) {
      const ref = relationship[endpoint];
      const artifact = artifactMap.get(ref.artifactId);
      if (!artifact) {
        findings.push({
          relationshipId: relationship.id,
          endpoint,
          code: 'missing_artifact',
          ref,
        });
        continue;
      }
      if (!ref.entityId && !ref.address) continue;
      if (typeof resolveEntity !== 'function') {
        findings.push({
          relationshipId: relationship.id,
          endpoint,
          code: 'entity_unresolved',
          ref,
        });
        continue;
      }
      const resolved = await resolveEntity(ref, artifact);
      if (resolved === undefined) {
        findings.push({
          relationshipId: relationship.id,
          endpoint,
          code: 'entity_unresolved',
          ref,
        });
      } else if (!resolved) {
        findings.push({
          relationshipId: relationship.id,
          endpoint,
          code: 'missing_entity',
          ref,
        });
      }
    }
  }
  return findings;
}
