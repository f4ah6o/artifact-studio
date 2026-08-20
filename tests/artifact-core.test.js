import { describe, expect, test } from 'vite-plus/test';
import {
  ArtifactContentError,
  normalizeArtifactContent,
  textContent,
  workspaceContent,
} from '../src/core/artifact-content.js';
import {
  adapterCapabilities,
  supportsAction,
  supportsCapability,
  supportsView,
} from '../src/core/artifact-capabilities.js';
import { GraphProjectionError, normalizeGraphProjection } from '../src/core/graph-projection.js';
import { graphProjectionToMermaid } from '../src/client/graph-renderer.js';

describe('canonical artifact content contract', () => {
  test('normalizes text and workspace without adapter-specific knowledge', () => {
    expect(normalizeArtifactContent(textContent(42))).toEqual({ kind: 'text', source: '42' });
    expect(
      normalizeArtifactContent(
        workspaceContent({
          files: { 'a.txt': 'A', 'b.txt': 'B' },
          entrypoints: ['a.txt', 'a.txt'],
          activeFile: 'b.txt',
        }),
      ),
    ).toEqual({
      kind: 'workspace',
      files: { 'a.txt': 'A', 'b.txt': 'B' },
      entrypoints: ['a.txt'],
      activeFile: 'b.txt',
      inputFile: null,
    });
  });

  test('rejects malformed generic workspace references', () => {
    expect(() => workspaceContent({ files: { 'a.txt': 'A' }, activeFile: 'missing.txt' })).toThrow(
      ArtifactContentError,
    );
    expect(() => normalizeArtifactContent({ kind: 'opa', source: 'package p' })).toThrow(
      /unsupported artifact content kind/,
    );
  });
});

describe('adapter capability surface', () => {
  test('queries core capabilities, adapter actions, and views declaratively', () => {
    const adapter = {
      capabilities: adapterCapabilities({
        validate: true,
        project: true,
        actions: ['evaluate', 'evaluate', 'test'],
        views: ['source', 'dependencies'],
      }),
    };

    expect(supportsCapability(adapter, 'validate')).toBe(true);
    expect(supportsCapability(adapter, 'format')).toBe(false);
    expect(supportsCapability(adapter, 'project')).toBe(true);
    expect(supportsCapability(adapter, 'evaluate')).toBe(false);
    expect(supportsAction(adapter, 'evaluate')).toBe(true);
    expect(supportsAction(adapter, 'missing')).toBe(false);
    expect(supportsView(adapter, 'dependencies')).toBe(true);
    expect(adapter.capabilities.actions).toEqual(['evaluate', 'test']);
  });
});

describe('generic GraphProjection', () => {
  test('normalizes deterministically and renders through a Mermaid backend representation', () => {
    const graph = normalizeGraphProjection({
      nodes: [
        { id: 'b', label: 'B' },
        { id: 'a', label: 'A "quoted"' },
      ],
      edges: [{ from: 'b', to: 'a', kind: 'depends-on' }],
    });

    expect(graph).toEqual({
      kind: 'graph',
      nodes: [
        { id: 'a', label: 'A "quoted"' },
        { id: 'b', label: 'B' },
      ],
      edges: [{ from: 'b', to: 'a', kind: 'depends-on' }],
    });
    expect(graphProjectionToMermaid(graph)).toBe(
      'flowchart LR\n  n0["A &quot;quoted&quot;"]\n  n1["B"]\n  n1 --> n0\n',
    );
  });

  test('rejects duplicate nodes and dangling edges', () => {
    expect(() =>
      normalizeGraphProjection({
        nodes: [
          { id: 'same', label: 'A' },
          { id: 'same', label: 'B' },
        ],
        edges: [],
      }),
    ).toThrow(GraphProjectionError);

    expect(() =>
      normalizeGraphProjection({
        nodes: [{ id: 'a', label: 'A' }],
        edges: [{ from: 'a', to: 'missing' }],
      }),
    ).toThrow(/dangling graph edge target/);
  });
});
