import { describe, expect, test } from 'vite-plus/test';
import {
  getArtifactAdapter,
  inferAdapterFromFileName,
  supportsCapability,
} from '../src/client/artifact-adapters.js';
import { graphProjectionToMermaid } from '../src/client/graph-renderer.js';
import { daguGraphProjection } from '../src/adapters/dagu.js';
import { dependencyProjection } from '../src/adapters/opa.js';

describe('GraphProjection second-consumer proof', () => {
  test('registers Dagu as generic text with validate/project capabilities', () => {
    const dagu = getArtifactAdapter('dagu');
    expect(dagu).toMatchObject({
      id: 'dagu',
      contentKind: 'text',
      exportFileName: 'workflow.yaml',
    });
    expect(supportsCapability(dagu, 'validate')).toBe(true);
    expect(supportsCapability(dagu, 'project')).toBe(true);
    expect(supportsCapability(dagu, 'format')).toBe(false);
    expect(inferAdapterFromFileName('workflow.yaml')).toBe('dagu');
    expect(inferAdapterFromFileName('workflow.yml')).toBe('dagu');
  });

  test('registers Bonita BDM as an exact bom.xml text artifact without stealing generic XML', () => {
    const bdm = getArtifactAdapter('bonita-bdm');
    expect(bdm).toMatchObject({
      id: 'bonita-bdm',
      contentKind: 'text',
      exportFileName: 'bom.xml',
    });
    expect(supportsCapability(bdm, 'validate')).toBe(true);
    expect(supportsCapability(bdm, 'project')).toBe(true);
    expect(inferAdapterFromFileName('bom.xml')).toBe('bonita-bdm');
    expect(inferAdapterFromFileName('/project/bdm/BOM.XML')).toBe('bonita-bdm');
    expect(inferAdapterFromFileName('process.bpmn.xml')).toBe('bpmn');
    expect(inferAdapterFromFileName('arbitrary.xml')).toBe(null);
  });

  test('OPA and Dagu normalize to the same graph contract and render through one generic entry point', () => {
    const opa = dependencyProjection(
      {
        base: [[{ value: 'input' }, { value: 'user' }]],
        virtual: [[{ value: 'data' }, { value: 'policy' }, { value: 'allow' }]],
      },
      'data.policy.allow',
    );
    const dagu = daguGraphProjection(`
steps:
  - id: extract
    run: ./extract.sh
  - id: load
    depends: extract
    run: ./load.sh
`);

    for (const graph of [opa, dagu]) {
      expect(graph.kind).toBe('graph');
      expect(Array.isArray(graph.nodes)).toBe(true);
      expect(Array.isArray(graph.edges)).toBe(true);
      expect(graphProjectionToMermaid(graph)).toMatch(/^flowchart LR\n/);
    }
  });
});
