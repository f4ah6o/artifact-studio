import { describe, expect, test } from 'vite-plus/test';
import { GraphProjectionError } from '../../src/core/graph-projection.js';
import {
  DaguCliError,
  daguGraphProjection,
  mapDaguValidationOutput,
  parseDaguStructure,
  validateDaguSource,
} from '../../src/adapters/dagu.js';

describe('Dagu structural projection', () => {
  test('projects scalar and array dependencies into the generic GraphProjection contract', () => {
    const graph = daguGraphProjection(`
steps:
  - id: extract
    run: ./extract.sh
  - id: transform_a
    depends: extract
    run: ./transform-a.sh
  - id: transform_b
    depends: "extract"
    run: ./transform-b.sh
  - id: load
    name: Load results
    depends: [transform_a, 'transform_b'] # join branches
    run: ./load.sh
`);

    expect(graph.kind).toBe('graph');
    expect(graph.nodes).toEqual([
      { id: 'dagu:0:step:extract', label: 'extract', kind: 'step' },
      { id: 'dagu:0:step:load', label: 'Load results', kind: 'step' },
      { id: 'dagu:0:step:transform_a', label: 'transform_a', kind: 'step' },
      { id: 'dagu:0:step:transform_b', label: 'transform_b', kind: 'step' },
    ]);
    expect(graph.edges).toEqual([
      { from: 'dagu:0:step:extract', to: 'dagu:0:step:transform_a', kind: 'depends-on' },
      { from: 'dagu:0:step:extract', to: 'dagu:0:step:transform_b', kind: 'depends-on' },
      { from: 'dagu:0:step:transform_a', to: 'dagu:0:step:load', kind: 'depends-on' },
      { from: 'dagu:0:step:transform_b', to: 'dagu:0:step:load', kind: 'depends-on' },
    ]);
  });

  test('resolves depends by step name or id and supports block arrays', () => {
    const graph = daguGraphProjection(`
steps:
  - id: fetch
    name: Fetch Source
    run: ./fetch.sh
  - name: Normalize
    run: ./normalize.sh
  - id: publish
    depends:
      - fetch
      - Normalize
    run: ./publish.sh
`);

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        { id: 'dagu:0:step:fetch', label: 'Fetch Source', kind: 'step' },
        { id: 'dagu:0:step:Normalize', label: 'Normalize', kind: 'step' },
        { id: 'dagu:0:step:publish', label: 'publish', kind: 'step' },
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'dagu:0:step:fetch', to: 'dagu:0:step:publish', kind: 'depends-on' },
        { from: 'dagu:0:step:Normalize', to: 'dagu:0:step:publish', kind: 'depends-on' },
      ]),
    );
  });

  test('keeps anonymous steps structurally visible without inventing scheduler semantics', () => {
    const structure = parseDaguStructure(`
type: chain
steps:
  - run: echo first
  - run: echo second
`);
    expect(structure[0].steps).toHaveLength(2);

    const graph = daguGraphProjection(`
type: chain
steps:
  - run: echo first
  - run: echo second
`);
    expect(graph.nodes).toEqual([
      { id: 'dagu:0:anonymous:0', label: 'Step 1', kind: 'step' },
      { id: 'dagu:0:anonymous:1', label: 'Step 2', kind: 'step' },
    ]);
    expect(graph.edges).toEqual([]);
  });

  test('does not claim cycle validity from the lightweight structural parser', () => {
    const graph = daguGraphProjection(`
steps:
  - id: A
    depends: B
    run: echo A
  - id: B
    depends: A
    run: echo B
`);
    expect(graph.edges).toHaveLength(2);
  });

  test('lets generic projection validation reject dangling dependency references', () => {
    expect(() =>
      daguGraphProjection(`
steps:
  - id: deploy
    depends: missing
    run: ./deploy.sh
`),
    ).toThrow(GraphProjectionError);
  });
});

describe('Dagu validation boundary', () => {
  test('maps CLI diagnostics to common findings', () => {
    expect(
      mapDaguValidationOutput(
        {
          exitCode: 1,
          stdout: '',
          stderr: '/tmp/private/workflow.yaml:7:3: invalid dependency\n',
        },
        '/tmp/private/workflow.yaml',
      ),
    ).toEqual([
      {
        severity: 'error',
        file: 'workflow.yaml',
        line: 7,
        column: 3,
        code: 'dagu_validation_error',
        message: 'invalid dependency',
      },
    ]);
  });

  test('reports a missing Dagu binary without treating source authoring as invalid', async () => {
    const previous = process.env.DAGU_BINARY;
    process.env.DAGU_BINARY = 'as-code-studio-definitely-missing-dagu-binary';
    try {
      await expect(
        validateDaguSource('steps:\n  - id: hello\n    run: echo hello\n'),
      ).rejects.toMatchObject({ code: 'DAGU_UNAVAILABLE' });
    } finally {
      if (previous == null) delete process.env.DAGU_BINARY;
      else process.env.DAGU_BINARY = previous;
    }
  });

  test('uses a typed CLI error for unavailable validation authority', async () => {
    const previous = process.env.DAGU_BINARY;
    process.env.DAGU_BINARY = 'as-code-studio-definitely-missing-dagu-binary';
    try {
      await expect(validateDaguSource('steps: []\n')).rejects.toBeInstanceOf(DaguCliError);
    } finally {
      if (previous == null) delete process.env.DAGU_BINARY;
      else process.env.DAGU_BINARY = previous;
    }
  });
});
