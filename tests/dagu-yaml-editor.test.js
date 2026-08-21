import { describe, expect, test } from 'vite-plus/test';
import {
  addDaguDependency,
  addDaguStep,
  deleteDaguStep,
  inspectDaguYaml,
  removeDaguDependency,
  updateDaguStep,
} from '../src/client/dagu-yaml-editor.js';

const source = `# workflow comment
name: example
custom_top_level:
  keep: true
steps:
  - id: fetch
    run: ./fetch.sh
    custom_step_field: keep-me
  - id: transform
    depends: fetch
    run: ./transform.sh
`;

describe('Dagu visual YAML editing', () => {
  test('can create the first step from an empty artifact', () => {
    const result = addDaguStep('');
    const model = inspectDaguYaml(result.source);
    expect(model.editable).toBe(true);
    expect(model.steps).toHaveLength(1);
    expect(model.steps[0].id).toBe('step_1');
  });

  test('inspects editable steps without discarding canonical YAML', () => {
    const model = inspectDaguYaml(source);
    expect(model.editable).toBe(true);
    expect(model.steps.map((step) => step.identity)).toEqual(['fetch', 'transform']);
    expect(model.steps[1].depends).toEqual(['fetch']);
  });

  test('adds a step while preserving unknown fields and comments', () => {
    const result = addDaguStep(source);
    expect(result.selectedStepIndex).toBe(2);
    expect(result.source).toContain('# workflow comment');
    expect(result.source).toContain('custom_top_level:');
    expect(result.source).toContain('custom_step_field: keep-me');
    expect(inspectDaguYaml(result.source).steps).toHaveLength(3);
  });

  test('updates supported properties and rewrites dependencies when the identity changes', () => {
    const updated = updateDaguStep(source, 0, {
      id: 'extract',
      name: 'Fetch source',
      run: './extract.sh',
      timeoutSec: '120',
      depends: [],
    });
    const model = inspectDaguYaml(updated);
    expect(model.steps[0]).toMatchObject({
      id: 'extract',
      name: 'Fetch source',
      run: './extract.sh',
      timeoutSec: '120',
    });
    expect(model.steps[1].depends).toEqual(['extract']);
    expect(updated).toContain('custom_step_field: keep-me');
  });

  test('edits safe retry policy fields while preserving exit_code', () => {
    const retrySource = `steps:
  - id: fetch
    run: ./fetch.sh
    retry_policy:
      limit: 3
      interval_sec: 5
      exit_code: [1, 28]
`;
    const model = inspectDaguYaml(retrySource);
    expect(model.steps[0].retryPolicy).toMatchObject({
      present: true,
      editable: true,
      limit: '3',
      intervalSec: '5',
    });

    const updated = updateDaguStep(retrySource, 0, {
      id: 'fetch',
      name: '',
      run: './fetch.sh',
      timeoutSec: '',
      depends: [],
      retryPolicy: {
        limit: '5',
        intervalSec: '10',
        backoff: 'true',
        maxIntervalSec: '60',
      },
    });
    expect(updated).toContain('limit: 5');
    expect(updated).toContain('interval_sec: 10');
    expect(updated).toContain('backoff: true');
    expect(updated).toContain('max_interval_sec: 60');
    expect(updated).toContain('exit_code: [ 1, 28 ]');
  });

  test('adds and removes dependencies using step identity', () => {
    const withStep = addDaguStep(source).source;
    const model = inspectDaguYaml(withStep);
    const added = addDaguDependency(withStep, 1, 2);
    expect(inspectDaguYaml(added).steps[2].depends).toEqual(['transform']);

    const removed = removeDaguDependency(added, 1, 2);
    expect(inspectDaguYaml(removed).steps[2].depends).toEqual([]);
    expect(model.steps).toHaveLength(3);
  });

  test('deletes a step and cleans dependencies that reference it', () => {
    const deleted = deleteDaguStep(source, 0);
    const model = inspectDaguYaml(deleted);
    expect(model.steps.map((step) => step.identity)).toEqual(['transform']);
    expect(model.steps[0].depends).toEqual([]);
  });

  test('fails closed for ambiguous aliases and multiple YAML documents', () => {
    expect(
      inspectDaguYaml(`steps:\n  - id: same\n    run: a\n  - name: same\n    run: b\n`).editable,
    ).toBe(false);
    expect(inspectDaguYaml('steps: []\n---\nsteps: []\n').editable).toBe(false);
  });
});
