import { describe, expect, test } from 'vite-plus/test';
import {
  ARTIFACT_CONTENT_STORAGE_KEY,
  persistArtifactContent,
  readArtifactContent,
  workspaceContent,
} from '../frontend/artifact-content.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

describe('generic artifact content persistence', () => {
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

    expect(JSON.parse(storage.getItem(ARTIFACT_CONTENT_STORAGE_KEY)).version).toBe(1);
    expect(readArtifactContent('opa', storage)).toEqual({
      kind: 'workspace',
      files: { 'policy.rego': 'package policy\n' },
      entrypoints: [],
      activeFile: 'policy.rego',
      inputFile: null,
    });
  });
});
