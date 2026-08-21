import { afterEach, describe, expect, test } from 'vite-plus/test';
import {
  clearArtifactRuntimesForTests,
  currentArtifactForAdapter,
  findCurrentArtifactById,
  getArtifactRuntime,
  listArtifactRuntimes,
  openArtifact,
  projectArtifact,
  registerArtifactRuntime,
  resolveSemanticRefForArtifact,
  semanticEntitiesForArtifact,
} from '../src/client/artifact-runtime-registry.js';
import { textContent } from '../src/core/artifact-content.js';

afterEach(() => clearArtifactRuntimesForTests());

describe('artifact runtime registry', () => {
  test('resolves generic current/project/open capabilities without adapter routing', async () => {
    const source = { id: 'source-1', adapterId: 'source', content: textContent('source') };
    const opened = [];

    registerArtifactRuntime('source', {
      currentArtifact: () => source,
      project: () => ({ nodes: [{ id: 'a', label: 'A' }], edges: [] }),
      semanticEntities: () => [
        {
          id: 'source:entity',
          artifactId: source.id,
          kind: 'entity',
          address: 'Source.Entity',
        },
      ],
    });
    registerArtifactRuntime('target', {
      currentArtifact: () => opened.at(-1) || null,
      openArtifact(artifact) {
        opened.push(artifact);
        return artifact;
      },
    });

    expect(listArtifactRuntimes().map((runtime) => runtime.adapterId)).toEqual([
      'source',
      'target',
    ]);
    expect(getArtifactRuntime('source')).not.toBeNull();
    expect(await currentArtifactForAdapter('source')).toEqual(source);
    expect(await findCurrentArtifactById('source-1')).toEqual(source);
    expect(await projectArtifact(source)).toEqual({ nodes: [{ id: 'a', label: 'A' }], edges: [] });
    expect(await semanticEntitiesForArtifact(source)).toEqual([
      { id: 'source:entity', artifactId: 'source-1', kind: 'entity', address: 'Source.Entity' },
    ]);
    expect(
      await resolveSemanticRefForArtifact(
        { artifactId: 'source-1', address: 'Source.Entity' },
        source,
      ),
    ).toEqual({
      id: 'source:entity',
      artifactId: 'source-1',
      kind: 'entity',
      address: 'Source.Entity',
    });

    const derived = { id: 'derived-1', adapterId: 'target', content: textContent('derived') };
    expect(await openArtifact(derived)).toEqual(derived);
    expect(await currentArtifactForAdapter('target')).toEqual(derived);
  });

  test('rejects semantic entity provider output for the wrong artifact', async () => {
    const artifact = { id: 'source-1', adapterId: 'source', content: textContent('source') };
    registerArtifactRuntime('source', {
      currentArtifact: () => artifact,
      semanticEntities: () => [{ id: 'entity', artifactId: 'other-artifact', kind: 'entity' }],
    });

    await expect(semanticEntitiesForArtifact(artifact)).rejects.toThrow(/unexpected artifact/);
  });

  test('returns unresolved when an adapter has no semantic entity provider', async () => {
    const artifact = { id: 'target-1', adapterId: 'target', content: textContent('target') };
    registerArtifactRuntime('target', { currentArtifact: () => artifact });
    expect(
      await resolveSemanticRefForArtifact(
        { artifactId: 'target-1', entityId: 'missing' },
        artifact,
      ),
    ).toBeUndefined();
  });

  test('rejects duplicate runtime ids', () => {
    registerArtifactRuntime('source', { currentArtifact: () => null });
    expect(() => registerArtifactRuntime('source', { currentArtifact: () => null })).toThrow(
      'duplicate artifact runtime: source',
    );
  });
});
