import { afterEach, describe, expect, test } from 'vite-plus/test';
import {
  architectureGraphForWorkspace,
  architectureGraphProjectionForWorkspace,
} from '../src/client/architecture-graph-runtime.js';
import {
  clearArtifactRuntimesForTests,
  registerArtifactRuntime,
} from '../src/client/artifact-runtime-registry.js';
import { textContent } from '../src/core/artifact-content.js';

afterEach(() => clearArtifactRuntimesForTests());

describe('Architecture Graph workspace runtime', () => {
  test('resolves persisted relationships through adapter semantic entity providers', async () => {
    const model = {
      id: 'model',
      adapterId: 'bonita-bdm',
      title: 'Model',
      content: textContent('<model/>'),
    };
    const process = {
      id: 'process',
      adapterId: 'bpmn',
      title: 'Process',
      content: textContent('<process/>'),
    };

    registerArtifactRuntime('bonita-bdm', {
      currentArtifact: () => model,
      semanticEntities: () => [
        {
          id: 'field-amount',
          artifactId: 'model',
          kind: 'field',
          label: 'amount',
          address: 'Order#amount',
        },
      ],
    });
    registerArtifactRuntime('bpmn', {
      currentArtifact: () => process,
    });

    const workspace = {
      version: 2,
      activeArtifactId: 'process',
      artifacts: { process, model },
      relationships: {
        reads: {
          id: 'reads',
          type: 'reads',
          from: { artifactId: 'process' },
          to: { artifactId: 'model', address: 'Order#amount' },
          provenance: 'declared',
        },
      },
    };

    const architecture = await architectureGraphForWorkspace(workspace);
    expect(architecture.findings).toEqual([]);
    expect(architecture.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Process', kind: 'artifact' }),
        expect.objectContaining({
          label: 'amount',
          kind: 'field',
          ref: {
            artifactId: 'model',
            entityId: 'field-amount',
            address: 'Order#amount',
          },
        }),
      ]),
    );

    const projected = await architectureGraphProjectionForWorkspace(workspace);
    expect(projected.findings).toEqual([]);
    expect(projected.graph.edges).toEqual([
      expect.objectContaining({
        kind: 'reads',
        metadata: { relationshipId: 'reads', provenance: 'declared' },
      }),
    ]);
  });

  test('marks semantic refs unresolved when the target adapter has no provider', async () => {
    const source = { id: 'source', adapterId: 'source', title: 'Source', content: textContent('') };
    const target = { id: 'target', adapterId: 'target', title: 'Target', content: textContent('') };
    registerArtifactRuntime('source', { currentArtifact: () => source });
    registerArtifactRuntime('target', { currentArtifact: () => target });

    const architecture = await architectureGraphForWorkspace({
      artifacts: { source, target },
      relationships: {
        link: {
          id: 'link',
          type: 'uses',
          from: { artifactId: 'source' },
          to: { artifactId: 'target', entityId: 'entity' },
          provenance: 'generated',
        },
      },
    });

    expect(architecture.findings).toEqual([
      expect.objectContaining({
        relationshipId: 'link',
        endpoint: 'to',
        code: 'entity_unresolved',
      }),
    ]);
  });
});
