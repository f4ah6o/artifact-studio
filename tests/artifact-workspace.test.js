import { describe, expect, test } from 'vite-plus/test';
import { textContent } from '../src/core/artifact-content.js';
import { artifactRevision, derivedArtifactStatus } from '../src/core/artifact-transform.js';
import {
  ARTIFACT_WORKSPACE_STORAGE_KEY,
  ArtifactWorkspaceStore,
  LEGACY_ARTIFACT_CONTENT_STORAGE_KEY,
  LEGACY_BPMN_STORAGE_KEY,
  LEGACY_SHELL_WORKSPACE_STORAGE_KEY,
  migrateArtifactWorkspace,
  readArtifactWorkspace,
} from '../src/client/artifact-workspace.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

describe('artifact workspace v2', () => {
  test('persists multiple same-adapter artifacts with stable active identity', () => {
    const storage = memoryStorage();
    const store = new ArtifactWorkspaceStore(storage);
    const a = store.create('mermaid', textContent('flowchart LR\n  a --> b\n'), {
      id: 'mermaid-a',
    });
    const b = store.create('mermaid', textContent('flowchart LR\n  x --> y\n'), {
      id: 'mermaid-b',
    });

    expect(a.id).not.toBe(b.id);
    expect(store.list('mermaid')).toHaveLength(2);
    expect(store.active().id).toBe('mermaid-b');

    store.select('mermaid-a');
    const reloaded = new ArtifactWorkspaceStore(storage);
    expect(reloaded.active().id).toBe('mermaid-a');
    expect(reloaded.get('mermaid-b').content.source).toContain('x --> y');
    expect(JSON.parse(storage.getItem(ARTIFACT_WORKSPACE_STORAGE_KEY)).version).toBe(2);
  });

  test('migrates generic content, shell metadata, and legacy BPMN without overwriting richer records', () => {
    const storage = memoryStorage();
    storage.setItem(
      LEGACY_ARTIFACT_CONTENT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        artifacts: {
          dagu: {
            id: 'dagu-existing',
            content: textContent('steps:\n  - id: source\n'),
            lineage: { transform: 'legacy-transform', derivedFrom: [], transformVersion: '1' },
          },
        },
      }),
    );
    storage.setItem(
      LEGACY_SHELL_WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeAdapter: 'dagu',
        artifacts: {
          dagu: { source: 'shell must not replace richer generic content' },
          mermaid: { source: 'flowchart LR\n  a --> b\n' },
        },
        aiSessions: { dagu: { id: 'ai-dagu' } },
      }),
    );
    storage.setItem(
      LEGACY_BPMN_STORAGE_KEY,
      JSON.stringify({ version: 1, xml: '<definitions />', savedAt: '2026-08-21T00:00:00Z' }),
    );

    const migrated = migrateArtifactWorkspace(storage);
    expect(migrated.version).toBe(2);
    expect(migrated.activeArtifactId).toBe('dagu-existing');
    expect(migrated.artifacts['dagu-existing'].content.source).toContain('id: source');
    expect(migrated.artifacts['dagu-existing'].lineage.transform).toBe('legacy-transform');
    expect(
      Object.values(migrated.artifacts).some((artifact) => artifact.adapterId === 'mermaid'),
    ).toBe(true);
    expect(
      Object.values(migrated.artifacts).some((artifact) => artifact.adapterId === 'bpmn'),
    ).toBe(true);
    expect(migrated.aiSessions.dagu.id).toBe('ai-dagu');

    expect(readArtifactWorkspace(storage)).toEqual(migrated);
  });

  test('reload preserves lineage source ids for current/stale evaluation', async () => {
    const storage = memoryStorage();
    const store = new ArtifactWorkspaceStore(storage);
    const source = store.create('dagu', textContent('steps:\n  - id: a\n'), { id: 'source' });
    const sourceRevision = await artifactRevision(source);
    store.create('mermaid', textContent('flowchart LR\n  a\n'), { id: 'derived' });
    store.upsert(
      {
        ...store.get('derived'),
        lineage: {
          derivedFrom: [{ artifactId: 'source', revision: sourceRevision }],
          transform: 'graph-projection-to-mermaid',
          transformVersion: '1',
        },
      },
      { activate: true },
    );

    const reloaded = new ArtifactWorkspaceStore(storage);
    expect(await derivedArtifactStatus(reloaded.get('derived'), [reloaded.get('source')])).toBe(
      'current',
    );

    reloaded.upsert({ ...reloaded.get('source'), content: textContent('steps:\n  - id: b\n') });
    expect(await derivedArtifactStatus(reloaded.get('derived'), [reloaded.get('source')])).toBe(
      'stale',
    );
  });
});
