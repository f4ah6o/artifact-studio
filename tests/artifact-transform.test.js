import { describe, expect, test } from 'vite-plus/test';
import { textContent, workspaceContent } from '../src/core/artifact-content.js';
import {
  ArtifactTransformError,
  ArtifactTransformRegistry,
  artifactRevision,
  defineArtifactTransform,
  derivedArtifactStatus,
  executeArtifactTransform,
  regenerateDerivedArtifact,
} from '../src/core/artifact-transform.js';
import {
  builtInArtifactTransforms,
  createBuiltInArtifactTransformRegistry,
  graphProjectionToMermaidTransform,
} from '../src/core/builtin-artifact-transforms.js';
import { daguGraphProjection } from '../src/adapters/dagu.js';
import { dependencyProjection } from '../src/adapters/opa.js';

function daguSource(extra = '') {
  return `steps:\n  - id: extract\n    run: ./extract.sh\n  - id: load\n    depends: extract\n    run: ./load.sh\n${extra}`;
}

describe('ArtifactTransform registry', () => {
  test('registers exactly one built-in transform and resolves it generically', () => {
    const registry = createBuiltInArtifactTransformRegistry();

    expect(builtInArtifactTransforms).toHaveLength(1);
    expect(registry.list()).toEqual([graphProjectionToMermaidTransform]);
    expect(registry.get('graph-projection-to-mermaid')).toMatchObject({
      id: 'graph-projection-to-mermaid',
      from: ['opa', 'dagu'],
      to: 'mermaid',
      version: '1',
    });
    expect(registry.applicableTo('opa').map((transform) => transform.id)).toEqual([
      'graph-projection-to-mermaid',
    ]);
    expect(registry.applicableTo('dagu').map((transform) => transform.id)).toEqual([
      'graph-projection-to-mermaid',
    ]);
    expect(registry.applicableTo('bpmn')).toEqual([]);
  });

  test('rejects malformed descriptors and duplicate ids deterministically', () => {
    expect(() =>
      defineArtifactTransform({
        id: 'Bad Transform',
        label: 'Bad',
        from: 'dagu',
        to: 'mermaid',
        version: '1',
        transform() {
          return textContent('flowchart LR\n');
        },
      }),
    ).toThrow(ArtifactTransformError);

    const registry = new ArtifactTransformRegistry([graphProjectionToMermaidTransform]);
    expect(() => registry.register(graphProjectionToMermaidTransform)).toThrow(
      'duplicate transform id: graph-projection-to-mermaid',
    );
  });
});

describe('artifact revision and lineage', () => {
  test('preserves explicit revision and hashes canonical content deterministically', async () => {
    const explicit = {
      id: 'source',
      adapterId: 'dagu',
      revision: 'git:abc123',
      content: textContent(daguSource()),
    };
    expect(await artifactRevision(explicit)).toBe('git:abc123');

    const first = {
      id: 'opa-source',
      adapterId: 'opa',
      content: workspaceContent({
        files: { 'z.rego': 'package z\n', 'a.rego': 'package a\n' },
        activeFile: 'a.rego',
      }),
    };
    const second = {
      ...first,
      content: workspaceContent({
        files: { 'a.rego': 'package a\n', 'z.rego': 'package z\n' },
        activeFile: 'a.rego',
      }),
    };

    const firstRevision = await artifactRevision(first);
    expect(firstRevision).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await artifactRevision(second)).toBe(firstRevision);
  });

  test('records source id/revision and transform id/version outside canonical output', async () => {
    const registry = createBuiltInArtifactTransformRegistry();
    const source = {
      id: 'dagu-main',
      adapterId: 'dagu',
      revision: 'source-r1',
      content: textContent(daguSource()),
    };

    const derived = await executeArtifactTransform({
      registry,
      transformId: 'graph-projection-to-mermaid',
      artifact: source,
      derivedArtifactId: 'dagu-main-graph',
      context: { project: (artifact) => daguGraphProjection(artifact.content.source) },
    });

    expect(derived).toMatchObject({
      id: 'dagu-main-graph',
      adapterId: 'mermaid',
      content: { kind: 'text' },
      lineage: {
        derivedFrom: [{ artifactId: 'dagu-main', revision: 'source-r1' }],
        transform: 'graph-projection-to-mermaid',
        transformVersion: '1',
      },
    });
    expect(derived.content.source).toMatch(/^flowchart LR\n/);
    expect(derived.content).not.toHaveProperty('lineage');
  });
});

describe('GraphProjection -> Mermaid deterministic transform', () => {
  test('uses one transform with the existing OPA and Dagu projection paths', async () => {
    const registry = createBuiltInArtifactTransformRegistry();
    const opaSource = {
      id: 'opa-main',
      adapterId: 'opa',
      content: workspaceContent({ files: { 'policy.rego': 'package policy\n' } }),
    };
    const daguSourceArtifact = {
      id: 'dagu-main',
      adapterId: 'dagu',
      content: textContent(daguSource()),
    };

    let opaProjectionCalls = 0;
    const opaDerived = await executeArtifactTransform({
      registry,
      transformId: 'graph-projection-to-mermaid',
      artifact: opaSource,
      context: {
        project() {
          opaProjectionCalls += 1;
          return dependencyProjection(
            {
              base: [[{ value: 'input' }, { value: 'user' }]],
              virtual: [[{ value: 'data' }, { value: 'policy' }, { value: 'allow' }]],
            },
            'data.policy.allow',
          );
        },
      },
    });

    let daguProjectionCalls = 0;
    const projectDagu = (artifact) => {
      daguProjectionCalls += 1;
      return daguGraphProjection(artifact.content.source);
    };
    const daguDerived = await executeArtifactTransform({
      registry,
      transformId: 'graph-projection-to-mermaid',
      artifact: daguSourceArtifact,
      context: { project: projectDagu },
    });
    const daguDerivedAgain = await executeArtifactTransform({
      registry,
      transformId: 'graph-projection-to-mermaid',
      artifact: daguSourceArtifact,
      context: { project: projectDagu },
    });

    expect(opaProjectionCalls).toBe(1);
    expect(daguProjectionCalls).toBe(2);
    expect(opaDerived.content.source).toMatch(/^flowchart LR\n/);
    expect(daguDerived.content.source).toMatch(/^flowchart LR\n/);
    expect(daguDerived.content.source).toBe(daguDerivedAgain.content.source);
    expect(daguDerived.lineage).toEqual(daguDerivedAgain.lineage);
  });

  test('fails explicitly when the generic projection capability is not supplied', async () => {
    await expect(
      executeArtifactTransform({
        registry: createBuiltInArtifactTransformRegistry(),
        transformId: 'graph-projection-to-mermaid',
        artifact: {
          id: 'dagu-main',
          adapterId: 'dagu',
          content: textContent(daguSource()),
        },
      }),
    ).rejects.toThrow('requires context.project(sourceArtifact)');
  });
});

describe('derived artifact freshness', () => {
  test('moves current -> stale -> regenerated/current when source content changes', async () => {
    const registry = createBuiltInArtifactTransformRegistry();
    const sourceV1 = {
      id: 'dagu-main',
      adapterId: 'dagu',
      content: textContent(daguSource()),
    };
    const context = { project: (artifact) => daguGraphProjection(artifact.content.source) };

    const derivedV1 = await executeArtifactTransform({
      registry,
      transformId: 'graph-projection-to-mermaid',
      artifact: sourceV1,
      derivedArtifactId: 'dagu-main-graph',
      context,
    });
    expect(await derivedArtifactStatus(derivedV1, sourceV1)).toBe('current');

    const sourceV2 = {
      ...sourceV1,
      content: textContent(
        daguSource('  - id: publish\n    depends: load\n    run: ./publish.sh\n'),
      ),
    };
    expect(await derivedArtifactStatus(derivedV1, sourceV2)).toBe('stale');

    const derivedV2 = await regenerateDerivedArtifact({
      registry,
      derivedArtifact: derivedV1,
      artifact: sourceV2,
      context,
    });

    expect(derivedV2.id).toBe('dagu-main-graph');
    expect(derivedV2.lineage.derivedFrom[0].revision).not.toBe(
      derivedV1.lineage.derivedFrom[0].revision,
    );
    expect(derivedV2.content.source).not.toBe(derivedV1.content.source);
    expect(await derivedArtifactStatus(derivedV2, sourceV2)).toBe('current');
  });

  test('fails instead of claiming current when the lineage source is missing', async () => {
    const registry = createBuiltInArtifactTransformRegistry();
    const source = {
      id: 'dagu-main',
      adapterId: 'dagu',
      content: textContent(daguSource()),
    };
    const derived = await executeArtifactTransform({
      registry,
      transformId: 'graph-projection-to-mermaid',
      artifact: source,
      context: { project: (artifact) => daguGraphProjection(artifact.content.source) },
    });

    await expect(
      derivedArtifactStatus(derived, {
        id: 'other-source',
        adapterId: 'dagu',
        content: source.content,
      }),
    ).rejects.toThrow('current source artifact is missing: dagu-main');
  });
});
