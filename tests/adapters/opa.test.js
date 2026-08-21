import { describe, expect, test } from 'vite-plus/test';
import {
  OpaWorkspaceError,
  dependencyProjection,
  formatJsonSource,
  mapOpaErrors,
  normalizeWorkspace,
  opaDiscoveredRelationshipsFromDependencies,
  opaSemanticEntitiesFromParsedModules,
  validateWorkspacePath,
} from '../../src/adapters/opa.js';

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

describe('OPA semantic entities', () => {
  const term = (type, value) => ({ type, value });

  test('exposes packages and aggregates logical rules across definitions', () => {
    const entities = opaSemanticEntitiesFromParsedModules(
      [
        {
          file: 'policy/approval.rego',
          module: {
            package: {
              path: [term('var', 'data'), term('string', 'invoice'), term('string', 'approval')],
            },
            rules: [
              { default: true, head: { name: 'allow', value: term('boolean', false) } },
              { head: { name: 'allow', value: term('boolean', true) } },
              { head: { name: 'is_admin', args: [term('var', 'user')] } },
              { head: { name: 'roles', key: term('var', 'k'), value: term('var', 'v') } },
            ],
          },
        },
        {
          file: 'policy/approval-extra.rego',
          module: {
            package: {
              path: [term('var', 'data'), term('string', 'invoice'), term('string', 'approval')],
            },
            rules: [{ head: { name: 'allow', value: term('boolean', true) } }],
          },
        },
      ],
      'artifact-opa',
    );

    expect(entities).toEqual(
      expect.arrayContaining([
        {
          id: 'opa:package:data.invoice.approval',
          artifactId: 'artifact-opa',
          kind: 'package',
          label: 'invoice.approval',
          address: 'data.invoice.approval',
          metadata: { files: ['policy/approval-extra.rego', 'policy/approval.rego'] },
        },
        expect.objectContaining({
          id: 'opa:rule:data.invoice.approval.allow',
          artifactId: 'artifact-opa',
          kind: 'rule',
          label: 'allow',
          address: 'data.invoice.approval.allow',
          metadata: expect.objectContaining({
            definitionCount: 3,
            hasDefault: true,
            partial: false,
            arities: [0],
          }),
        }),
        expect.objectContaining({
          address: 'data.invoice.approval.is_admin',
          metadata: expect.objectContaining({ arities: [1], partial: false }),
        }),
        expect.objectContaining({
          address: 'data.invoice.approval.roles',
          metadata: expect.objectContaining({ arities: [0], partial: true }),
        }),
      ]),
    );
  });

  test('maps OPA dependency closure to discovered rule dependencies only', () => {
    const entities = [
      { id: 'rule-a', artifactId: 'artifact-opa', kind: 'rule', address: 'data.demo.a' },
      { id: 'rule-b', artifactId: 'artifact-opa', kind: 'rule', address: 'data.demo.b' },
      { id: 'rule-c', artifactId: 'artifact-opa', kind: 'rule', address: 'data.demo.c' },
    ];
    const ref = (...values) =>
      values.map((value, index) => ({
        type: index === 0 ? 'var' : 'string',
        value,
      }));
    const relationships = opaDiscoveredRelationshipsFromDependencies(
      entities,
      {
        'data.demo.a': {
          base: [ref('input', 'x')],
          virtual: [ref('data', 'demo', 'a'), ref('data', 'demo', 'b'), ref('data', 'demo', 'c')],
        },
        'data.demo.b': {
          virtual: [ref('data', 'demo', 'b'), ref('data', 'demo', 'c')],
        },
        'data.demo.c': { virtual: [ref('data', 'demo', 'c'), ref('data', 'other', 'missing')] },
      },
      'artifact-opa',
    );

    expect(relationships).toHaveLength(3);
    expect(relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'depends-on',
          provenance: 'discovered',
          from: expect.objectContaining({ address: 'data.demo.a' }),
          to: expect.objectContaining({ address: 'data.demo.b' }),
        }),
        expect.objectContaining({
          from: expect.objectContaining({ address: 'data.demo.a' }),
          to: expect.objectContaining({ address: 'data.demo.c' }),
        }),
        expect.objectContaining({
          from: expect.objectContaining({ address: 'data.demo.b' }),
          to: expect.objectContaining({ address: 'data.demo.c' }),
        }),
      ]),
    );
  });
});
