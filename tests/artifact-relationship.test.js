import { describe, expect, test } from 'vite-plus/test';
import {
  ArtifactRelationshipError,
  artifactRelationship,
  semanticRef,
  validateArtifactRelationshipReferences,
} from '../src/core/artifact-relationship.js';

describe('ArtifactRelationship / SemanticRef core', () => {
  test('keeps relationship type open while normalizing logical semantic refs', () => {
    const relationship = artifactRelationship({
      id: 'rel-1',
      type: 'custom:reads-business-concept',
      from: { artifactId: 'process', entityId: 'task-approve', address: 'Process.Approve' },
      to: {
        artifactId: 'model',
        entityId: 'Invoice.amount',
        address: 'BusinessModel.Invoice.amount',
      },
      provenance: 'declared',
    });

    expect(relationship.type).toBe('custom:reads-business-concept');
    expect(relationship.from).toEqual({
      artifactId: 'process',
      entityId: 'task-approve',
      address: 'Process.Approve',
    });
    expect(relationship.to.address).toBe('BusinessModel.Invoice.amount');
  });

  test('restricts provenance but not type vocabulary', () => {
    expect(() =>
      artifactRelationship({
        id: 'rel-1',
        type: 'anything-useful',
        from: { artifactId: 'a' },
        to: { artifactId: 'b' },
        provenance: 'guessed',
      }),
    ).toThrow(ArtifactRelationshipError);
    expect(semanticRef({ artifactId: 'a' })).toEqual({ artifactId: 'a' });
  });

  test('reports missing artifacts and unresolved/missing semantic entities explicitly', async () => {
    const relationships = [
      {
        id: 'missing-artifact',
        type: 'custom',
        from: { artifactId: 'missing' },
        to: { artifactId: 'model' },
        provenance: 'generated',
      },
      {
        id: 'entity-ref',
        type: 'reads',
        from: { artifactId: 'process', entityId: 'task' },
        to: { artifactId: 'model', entityId: 'missing-field' },
        provenance: 'discovered',
      },
    ];
    const artifacts = {
      process: { id: 'process', adapterId: 'bpmn' },
      model: { id: 'model', adapterId: 'business-data-model' },
    };

    expect(await validateArtifactRelationshipReferences(relationships, { artifacts })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relationshipId: 'missing-artifact', code: 'missing_artifact' }),
        expect.objectContaining({
          relationshipId: 'entity-ref',
          endpoint: 'from',
          code: 'entity_unresolved',
        }),
        expect.objectContaining({
          relationshipId: 'entity-ref',
          endpoint: 'to',
          code: 'entity_unresolved',
        }),
      ]),
    );

    const resolved = await validateArtifactRelationshipReferences(relationships, {
      artifacts,
      resolveEntity: async (ref) => ref.entityId === 'task',
    });
    expect(resolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relationshipId: 'missing-artifact', code: 'missing_artifact' }),
        expect.objectContaining({
          relationshipId: 'entity-ref',
          endpoint: 'to',
          code: 'missing_entity',
        }),
      ]),
    );
    expect(resolved.some((finding) => finding.code === 'entity_unresolved')).toBe(false);
  });
});
