/**
 * HTTP API routing tests.
 *
 * AI-success paths are covered at the agent/provider layer so this suite can
 * stay deterministic and never depend on an authenticated Codex process.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vite-plus/test';
import { getCodexStatus, server } from './http-server.js';

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
