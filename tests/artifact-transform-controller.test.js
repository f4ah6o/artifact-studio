import { describe, expect, test } from 'vite-plus/test';
import { textContent } from '../src/core/artifact-content.js';
import { createBuiltInArtifactTransformRegistry } from '../src/core/builtin-artifact-transforms.js';
import { createArtifactTransformController } from '../src/client/artifact-transform-controller.js';

describe('artifact transform UI controller', () => {
  test('drives registry transform and current -> stale -> regenerate -> current generically', async () => {
    const artifacts = new Map();
    artifacts.set('dagu', {
      id: 'source-dagu',
      adapterId: 'dagu',
      content: textContent('steps:\n  - id: extract\n  - id: load\n'),
    });

    const registry = createBuiltInArtifactTransformRegistry();
    const controller = createArtifactTransformController({
      registry,
      currentForAdapter: async (adapterId) => artifacts.get(adapterId) || null,
      findById: async (artifactId) =>
        [...artifacts.values()].find((artifact) => artifact.id === artifactId) || null,
      project: async (artifact) => ({
        nodes: artifact.content.source.includes('publish')
          ? [
              { id: 'extract', label: 'extract' },
              { id: 'publish', label: 'publish' },
            ]
          : [
              { id: 'extract', label: 'extract' },
              { id: 'load', label: 'load' },
            ],
        edges: artifact.content.source.includes('publish')
          ? [{ from: 'extract', to: 'publish' }]
          : [{ from: 'extract', to: 'load' }],
      }),
      open: async (artifact) => {
        const opened = { ...artifact, id: artifact.id || `artifact:${artifact.adapterId}` };
        artifacts.set(opened.adapterId, opened);
        return opened;
      },
    });

    const sourceState = await controller.currentState('dagu');
    expect(sourceState.transforms.map((transform) => transform.id)).toEqual([
      'graph-projection-to-mermaid',
    ]);

    const derivedV1 = await controller.transformCurrent('dagu', 'graph-projection-to-mermaid');
    expect(derivedV1.adapterId).toBe('mermaid');
    expect(derivedV1.content.kind).toBe('text');
    expect(derivedV1.content.source).toContain('flowchart LR');
    expect(derivedV1.lineage).toMatchObject({
      derivedFrom: [{ artifactId: 'source-dagu' }],
      transform: 'graph-projection-to-mermaid',
      transformVersion: '1',
    });
    expect((await controller.currentState('mermaid')).status).toBe('current');

    artifacts.set('dagu', {
      id: 'source-dagu',
      adapterId: 'dagu',
      content: textContent('steps:\n  - id: extract\n  - id: publish\n'),
    });
    expect((await controller.currentState('mermaid')).status).toBe('stale');

    const derivedV2 = await controller.regenerateCurrent('mermaid');
    expect(derivedV2.id).toBe(derivedV1.id);
    expect(derivedV2.content.source).toContain('publish');
    expect(derivedV2.lineage.derivedFrom[0].revision).not.toBe(
      derivedV1.lineage.derivedFrom[0].revision,
    );
    expect((await controller.currentState('mermaid')).status).toBe('current');
  });
});
