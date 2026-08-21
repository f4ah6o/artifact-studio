/**
 * HTTP API routing tests.
 *
 * AI-success paths are covered at the agent/provider layer so this suite can
 * stay deterministic and never depend on an authenticated Codex process.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vite-plus/test';
import { getCodexStatus, server } from '../src/server/http-server.js';

let baseUrl;

beforeAll(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function advertisedModels() {
  return [
    {
      id: 'model-default',
      model: 'model-default',
      displayName: 'Model Default',
      description: 'Default model',
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: 'low',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: 'low' },
        { reasoningEffort: 'high', description: 'high' },
      ],
    },
    {
      id: 'model-other',
      model: 'model-other',
      displayName: 'Model Other',
      description: 'Other model',
      hidden: false,
      isDefault: false,
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'medium', description: 'medium' },
        { reasoningEffort: 'high', description: 'high' },
      ],
    },
  ];
}

describe('HTTP API', () => {
  test('GET /health reports ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(typeof data.uptime).toBe('number');
  });

  test('Codex status exposes model/list catalog and advertised defaults', async () => {
    const client = {
      accountRead: async () => ({ account: { type: 'chatgpt', planType: 'plus' } }),
      listModels: async () => advertisedModels(),
    };
    const status = await getCodexStatus({ client, env: {} });

    expect(status).toMatchObject({
      available: true,
      authenticated: true,
      planType: 'plus',
      model: 'model-default',
      effort: 'low',
    });
    expect(status.models.map((model) => model.model)).toEqual(['model-default', 'model-other']);
  });

  test('Codex environment model/effort remain deterministic bootstrap defaults', async () => {
    const client = {
      accountRead: async () => ({ account: { type: 'chatgpt', planType: 'plus' } }),
      listModels: async () => advertisedModels(),
    };
    const status = await getCodexStatus({
      client,
      env: { CODEX_MODEL: 'model-other', CODEX_EFFORT: 'high' },
    });

    expect(status.model).toBe('model-other');
    expect(status.effort).toBe('high');
  });

  test('POST /api/v1/chat rejects missing messages before invoking Codex', async () => {
    const res = await fetch(`${baseUrl}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/messages/i);
  });

  test('POST /api/v1/chat rejects an empty messages array before invoking Codex', async () => {
    const res = await fetch(`${baseUrl}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /api/v1/artifacts/mermaid/generate rejects missing userText before invoking Codex', async () => {
    const res = await fetch(`${baseUrl}/api/v1/artifacts/mermaid/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/userText/i);
  });

  test('OPA adapter actions are served by the main HTTP server', async () => {
    const response = await fetch(`${baseUrl}/api/v1/artifacts/opa/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: { files: { '../policy.rego': 'package p\n' } } }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe('OPA_WORKSPACE_INVALID');
    expect(body.error).toMatch(/Unsafe workspace path/);
  });

  test('OPA adapter rejects malformed JSON workspace data through the main server', async () => {
    const response = await fetch(`${baseUrl}/api/v1/artifacts/opa/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: { files: { 'data.json': '{oops' } } }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Invalid JSON/);
  });

  test('BPMN semantic entities are served by the main HTTP server', async () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://example.com/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Start"/>
    <bpmn:userTask id="Task_Approve" name="Approve Order"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_Approve"/>
  </bpmn:process>
</bpmn:definitions>`;
    const response = await fetch(`${baseUrl}/api/v1/artifacts/bpmn/entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source, artifactId: 'artifact-http-bpmn' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('success');
    expect(body.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bpmn:Process_1',
          artifactId: 'artifact-http-bpmn',
          kind: 'process',
          address: '#Process_1',
        }),
        expect.objectContaining({
          id: 'bpmn:Task_Approve',
          artifactId: 'artifact-http-bpmn',
          kind: 'activity',
          label: 'Approve Order',
          address: '#Task_Approve',
        }),
        expect.objectContaining({
          id: 'bpmn:Flow_1',
          kind: 'sequence-flow',
        }),
      ]),
    );
  });

  test('Bonita BDM inspect and projection are served by the main HTTP server', async () => {
    const source = `<?xml version="1.0"?><businessObjectModel modelVersion="1.0"><businessObjects>
      <businessObject qualifiedName="com.company.Order"><fields>
        <relationField type="COMPOSITION" reference="com.company.Line" fetchType="LAZY" name="lines" nullable="false" collection="true"/>
      </fields><uniqueConstraints/><queries/><indexes/></businessObject>
      <businessObject qualifiedName="com.company.Line"><fields>
        <field type="STRING" name="description" nullable="false" collection="false"/>
      </fields><uniqueConstraints/><queries/><indexes/></businessObject>
    </businessObjects></businessObjectModel>`;

    const inspected = await fetch(`${baseUrl}/api/v1/artifacts/bonita-bdm/inspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toMatchObject({
      status: 'success',
      model: {
        modelVersion: '1.0',
        errors: [],
        businessObjects: [
          { qualifiedName: 'com.company.Order' },
          { qualifiedName: 'com.company.Line' },
        ],
      },
    });

    const projected = await fetch(`${baseUrl}/api/v1/artifacts/bonita-bdm/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    expect(projected.status).toBe(200);
    const projection = await projected.json();
    expect(projection.status).toBe('success');
    expect(projection.graph.nodes).toHaveLength(2);
    expect(projection.graph.edges).toEqual([
      expect.objectContaining({
        kind: 'composition',
        metadata: expect.objectContaining({ fieldName: 'lines' }),
      }),
    ]);

    const entitiesResponse = await fetch(`${baseUrl}/api/v1/artifacts/bonita-bdm/entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source, artifactId: 'artifact-http-bdm' }),
    });
    expect(entitiesResponse.status).toBe(200);
    const entityBody = await entitiesResponse.json();
    expect(entityBody.status).toBe('success');
    expect(entityBody.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bonita-bdm:com.company.Order',
          artifactId: 'artifact-http-bdm',
          kind: 'business-object',
          address: 'com.company.Order',
        }),
        expect.objectContaining({
          id: 'bonita-bdm:com.company.Order#field:lines',
          artifactId: 'artifact-http-bdm',
          kind: 'field',
          address: 'com.company.Order#lines',
          metadata: expect.objectContaining({
            fieldKind: 'relation',
            reference: 'com.company.Line',
          }),
        }),
      ]),
    );
  });

  test('Dagu projection is served by the main HTTP server without the Dagu binary', async () => {
    const response = await fetch(`${baseUrl}/api/v1/artifacts/dagu/project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source:
          'steps:\n  - id: build\n    run: make\n  - id: test\n    depends: build\n    run: make test\n',
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('success');
    expect(body.graph).toEqual({
      kind: 'graph',
      nodes: [
        { id: 'dagu:0:step:build', label: 'build', kind: 'step' },
        { id: 'dagu:0:step:test', label: 'test', kind: 'step' },
      ],
      edges: [{ from: 'dagu:0:step:build', to: 'dagu:0:step:test', kind: 'depends-on' }],
    });
  });

  test('Dagu capabilities remain available when its CLI is missing', async () => {
    const previousBinary = process.env.DAGU_BINARY;
    process.env.DAGU_BINARY = 'as-code-studio-definitely-missing-dagu-binary';
    try {
      const response = await fetch(`${baseUrl}/api/v1/artifacts/dagu/capabilities`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        status: 'success',
        capabilities: {
          validate: { available: false, reason: 'DAGU_UNAVAILABLE' },
          project: { available: true, reason: null },
          version: null,
        },
      });
    } finally {
      if (previousBinary == null) delete process.env.DAGU_BINARY;
      else process.env.DAGU_BINARY = previousBinary;
    }
  });

  test('Dagu validation returns 503 through the main server when its CLI is missing', async () => {
    const previousBinary = process.env.DAGU_BINARY;
    process.env.DAGU_BINARY = 'as-code-studio-definitely-missing-dagu-binary';
    try {
      const response = await fetch(`${baseUrl}/api/v1/artifacts/dagu/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'steps:\n  - id: hello\n    run: echo hello\n' }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        status: 'error',
        code: 'DAGU_UNAVAILABLE',
      });
    } finally {
      if (previousBinary == null) delete process.env.DAGU_BINARY;
      else process.env.DAGU_BINARY = previousBinary;
    }
  });

  test('POST /api/v1/validate applies the Logic-Core schema gate', async () => {
    const res = await fetch(`${baseUrl}/api/v1/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logicCore: {} }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.status).toBe('schema_error');
    expect(Array.isArray(data.errors)).toBe(true);
  });
});
