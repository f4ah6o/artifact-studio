import { describe, expect, test } from 'vite-plus/test';
import {
  architectureGraphProjection,
  buildArchitectureGraph,
  projectArtifactRelationships,
  traverseArchitectureGraph,
} from '../src/core/architecture-graph.js';
import { resolveSemanticEntity } from '../src/core/semantic-entity.js';

const artifacts = {
  process: { id: 'process', adapterId: 'bpmn', title: 'Order Process' },
  model: { id: 'model', adapterId: 'bonita-bdm', title: 'Order Model' },
};

const entities = {
  process: [
    {
      id: 'task-approve',
      artifactId: 'process',
      kind: 'task',
      label: 'Approve Order',
      address: 'Process#approve',
    },
  ],
  model: [
    {
      id: 'field-amount',
      artifactId: 'model',
      kind: 'field',
      label: 'amount',
      address: 'com.example.Order#amount',
    },
  ],
};

async function resolver(ref, artifact) {
  const values = entities[artifact.id];
  if (!values) return undefined;
  return resolveSemanticEntity(values, ref);
}

describe('Architecture Graph projection', () => {
  test('resolves persisted semantic refs and preserves open relationship types', async () => {
    const relationships = [
      {
        id: 'uses-amount',
        type: 'custom:reads-business-field',
        from: { artifactId: 'process', entityId: 'task-approve' },
        to: { artifactId: 'model', address: 'com.example.Order#amount' },
        provenance: 'declared',
      },
      {
        id: 'artifact-link',
        type: 'implements',
        from: { artifactId: 'process' },
        to: { artifactId: 'model' },
        provenance: 'generated',
      },
    ];

    const architecture = await buildArchitectureGraph(relationships, {
      artifacts,
      resolveEntity: resolver,
    });
    expect(architecture.findings).toEqual([]);
    expect(architecture.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Approve Order',
          kind: 'task',
          status: 'resolved',
          ref: expect.objectContaining({ artifactId: 'process', entityId: 'task-approve' }),
        }),
        expect.objectContaining({
          label: 'amount',
          kind: 'field',
          status: 'resolved',
          ref: {
            artifactId: 'model',
            entityId: 'field-amount',
            address: 'com.example.Order#amount',
          },
        }),
        expect.objectContaining({ label: 'Order Process', kind: 'artifact' }),
        expect.objectContaining({ label: 'Order Model', kind: 'artifact' }),
      ]),
    );

    const projection = architectureGraphProjection(architecture);
    expect(projection.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'custom:reads-business-field',
          metadata: { relationshipId: 'uses-amount', provenance: 'declared' },
        }),
        expect.objectContaining({
          kind: 'implements',
          metadata: { relationshipId: 'artifact-link', provenance: 'generated' },
        }),
      ]),
    );
  });

  test('keeps broken and unresolved refs visible in a read-only projection', async () => {
    const result = await projectArtifactRelationships(
      [
        {
          id: 'missing-entity',
          type: 'reads',
          from: { artifactId: 'process', entityId: 'task-approve' },
          to: { artifactId: 'model', address: 'com.example.Order#missing' },
          provenance: 'discovered',
        },
        {
          id: 'missing-artifact',
          type: 'calls',
          from: { artifactId: 'process' },
          to: { artifactId: 'external-missing' },
          provenance: 'declared',
        },
      ],
      { artifacts, resolveEntity: resolver },
    );

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relationshipId: 'missing-entity', code: 'missing_entity' }),
        expect.objectContaining({ relationshipId: 'missing-artifact', code: 'missing_artifact' }),
      ]),
    );
    expect(result.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'semantic-ref',
          metadata: expect.objectContaining({ status: 'missing-entity' }),
        }),
        expect.objectContaining({
          kind: 'missing-artifact',
          metadata: expect.objectContaining({ status: 'missing-artifact' }),
        }),
      ]),
    );
    expect(result.graph.edges).toHaveLength(2);
  });
});

describe('Architecture Graph traversal', () => {
  test('returns shortest generic semantic paths in outgoing and incoming directions', async () => {
    const chainArtifacts = {
      a: { id: 'a', adapterId: 'test', title: 'A' },
      b: { id: 'b', adapterId: 'test', title: 'B' },
      c: { id: 'c', adapterId: 'test', title: 'C' },
    };
    const graph = await buildArchitectureGraph(
      [
        {
          id: 'a-b',
          type: 'depends-on',
          from: { artifactId: 'a' },
          to: { artifactId: 'b' },
          provenance: 'declared',
        },
        {
          id: 'b-c',
          type: 'custom:feeds',
          from: { artifactId: 'b' },
          to: { artifactId: 'c' },
          provenance: 'discovered',
        },
        {
          id: 'c-a',
          type: 'cycle-back',
          from: { artifactId: 'c' },
          to: { artifactId: 'a' },
          provenance: 'generated',
        },
      ],
      { artifacts: chainArtifacts },
    );

    const outgoing = traverseArchitectureGraph(
      graph,
      { artifactId: 'a' },
      { direction: 'outgoing' },
    );
    expect(outgoing.map((path) => [path.ref.artifactId, path.depth])).toEqual([
      ['b', 1],
      ['c', 2],
    ]);
    expect(outgoing[1].steps.map((step) => step.type)).toEqual(['depends-on', 'custom:feeds']);
    expect(outgoing[1].steps.every((step) => step.traversalDirection === 'outgoing')).toBe(true);

    const incoming = traverseArchitectureGraph(
      graph,
      { artifactId: 'a' },
      { direction: 'incoming' },
    );
    expect(incoming.map((path) => [path.ref.artifactId, path.depth])).toEqual([
      ['c', 1],
      ['b', 2],
    ]);
    expect(incoming[0].steps[0]).toMatchObject({
      type: 'cycle-back',
      traversalDirection: 'incoming',
    });

    expect(
      traverseArchitectureGraph(graph, { artifactId: 'a' }, { direction: 'outgoing', maxDepth: 1 }),
    ).toHaveLength(1);
  });
});
