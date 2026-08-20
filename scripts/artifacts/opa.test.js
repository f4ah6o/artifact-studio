import { describe, expect, test } from 'vite-plus/test';
import {
  OpaWorkspaceError,
  dependencyProjection,
  formatJsonSource,
  mapOpaErrors,
  normalizeWorkspace,
  validateWorkspacePath,
} from './opa.js';

describe('OPA workspace contract', () => {
  test('normalizes a multi-file workspace', () => {
    expect(
      normalizeWorkspace({
        files: {
          'policy/authz.rego': 'package authz\n',
          'data.json': '{"roles":{}}',
          'input.json': '{"user":"alice"}',
        },
        entrypoints: ['data.authz.allow', 'data.authz.allow'],
        activeFile: 'policy/authz.rego',
        inputFile: 'input.json',
      }),
    ).toEqual({
      files: {
        'policy/authz.rego': 'package authz\n',
        'data.json': '{"roles":{}}',
        'input.json': '{"user":"alice"}',
      },
      entrypoints: ['data.authz.allow'],
      activeFile: 'policy/authz.rego',
      inputFile: 'input.json',
    });
  });

  test.each([
    '../policy.rego',
    'a/../policy.rego',
    '/tmp/policy.rego',
    'C:/policy.rego',
    'a\\policy.rego',
    './policy.rego',
    'policy.txt',
  ])('rejects unsafe or unsupported path %s', (path) => {
    expect(() => validateWorkspacePath(path)).toThrow(OpaWorkspaceError);
  });

  test('rejects malformed JSON before invoking OPA', () => {
    expect(() => normalizeWorkspace({ files: { 'data.json': '{broken' } })).toThrow(/Invalid JSON/);
  });

  test('requires active/input references to exist', () => {
    expect(() =>
      normalizeWorkspace({
        files: { 'policy.rego': 'package policy\n' },
        inputFile: 'input.json',
      }),
    ).toThrow(/inputFile does not exist/);
  });
});

describe('OPA derived data', () => {
  test('formats JSON deterministically', () => {
    expect(formatJsonSource('{"z":1,"a":{"d":4,"b":2}}')).toBe(
      '{\n  "a": {\n    "b": 2,\n    "d": 4\n  },\n  "z": 1\n}\n',
    );
  });

  test('maps OPA diagnostics to common findings', () => {
    expect(
      mapOpaErrors(
        {
          errors: [
            {
              code: 'rego_parse_error',
              message: 'unexpected token',
              location: { file: '/tmp/ws/policy.rego', row: 4, col: 9 },
            },
          ],
        },
        '/tmp/ws',
      ),
    ).toEqual([
      {
        severity: 'error',
        file: 'policy.rego',
        line: 4,
        column: 9,
        code: 'rego_parse_error',
        message: 'unexpected token',
      },
    ]);
  });

  test('projects OPA dependencies into a generic graph', () => {
    const ref = (...values) =>
      values.map((value) => ({ type: typeof value === 'string' ? 'string' : 'var', value }));
    const graph = dependencyProjection(
      {
        base: [ref('input', 'user', 'roles'), ref('data', 'permissions')],
        virtual: [ref('data', 'policy', 'allow'), ref('data', 'policy', 'is_admin')],
      },
      'data.policy.allow',
    );
    expect(graph.kind).toBe('graph');
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        { id: 'query', label: 'data.policy.allow', kind: 'query' },
        expect.objectContaining({ label: 'input.user.roles', kind: 'base' }),
        expect.objectContaining({ label: 'data.policy.is_admin', kind: 'virtual' }),
      ]),
    );
    expect(graph.edges).toHaveLength(3);
  });
  test('accepts legacy dependency field names', () => {
    const graph = dependencyProjection(
      {
        base_documents: [['input', 'tenant']],
        virtual_documents: [['data', 'policy', 'allow']],
      },
      'data.policy.allow',
    );
    expect(graph.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'input.tenant', kind: 'base' })]),
    );
  });
});
