import { describe, expect, test } from 'vite-plus/test';
import {
  ARTIFACT_WORKSPACE_STORAGE_KEY,
  currentArtifactRecord,
  persistArtifactContent,
  persistArtifactRecord,
  readArtifactContent,
  readArtifactRecord,
  textContent,
  workspaceContent,
} from '../src/client/artifact-content.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

describe('generic artifact content persistence', () => {
  test('round-trips Dagu YAML as generic text content', () => {
    const storage = memoryStorage();
    const source = 'steps:\n  - id: hello\n    run: echo hello\n';
    persistArtifactContent('dagu', textContent(source), storage);

    expect(readArtifactContent('dagu', storage)).toEqual({ kind: 'text', source });
  });

  test('round-trips a workspace independently from the legacy text shell', () => {
    const storage = memoryStorage();
    persistArtifactContent(
      'opa',
      workspaceContent({
        files: { 'policy.rego': 'package policy\n' },
        activeFile: 'policy.rego',
      }),
      storage,
    );

    expect(JSON.parse(storage.getItem(ARTIFACT_WORKSPACE_STORAGE_KEY)).version).toBe(2);
    expect(readArtifactContent('opa', storage)).toEqual({
      kind: 'workspace',
      files: { 'policy.rego': 'package policy\n' },
      entrypoints: [],
      activeFile: 'policy.rego',
      inputFile: null,
    });
  });

  test('preserves derived artifact identity and lineage when canonical content changes', () => {
    const storage = memoryStorage();
    const lineage = {
      derivedFrom: [{ artifactId: 'artifact:dagu', revision: 'sha256:source-v1' }],
      transform: 'graph-projection-to-mermaid',
      transformVersion: '1',
    };

    persistArtifactRecord(
      {
        id: 'derived-mermaid',
        adapterId: 'mermaid',
        content: textContent('flowchart TD\n  a --> b\n'),
        lineage,
      },
      storage,
    );
    persistArtifactContent('mermaid', textContent('flowchart TD\n  a --> c\n'), storage);

    expect(readArtifactRecord('mermaid', storage)).toMatchObject({
      id: 'derived-mermaid',
      adapterId: 'mermaid',
      content: textContent('flowchart TD\n  a --> c\n'),
      lineage,
    });
    expect(
      currentArtifactRecord('mermaid', textContent('flowchart TD\n  a --> d\n'), storage),
    ).toMatchObject({
      id: 'derived-mermaid',
      adapterId: 'mermaid',
      content: textContent('flowchart TD\n  a --> d\n'),
      lineage,
    });
  });
});
