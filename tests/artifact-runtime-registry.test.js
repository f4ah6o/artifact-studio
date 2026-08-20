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

    const derived = { id: 'derived-1', adapterId: 'target', content: textContent('derived') };
    expect(await openArtifact(derived)).toEqual(derived);
    expect(await currentArtifactForAdapter('target')).toEqual(derived);
  });

  test('rejects duplicate runtime ids', () => {
    registerArtifactRuntime('source', { currentArtifact: () => null });
    expect(() => registerArtifactRuntime('source', { currentArtifact: () => null })).toThrow(
      'duplicate artifact runtime: source',
    );
  });
});
