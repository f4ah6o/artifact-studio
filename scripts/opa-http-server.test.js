import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { createOpaHttpServer } from './opa-http-server.js';

let server;
let baseUrl;

beforeAll(async () => {
  server = createOpaHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('OPA adapter HTTP API', () => {
  test('health is independent from the OPA executable', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'opa-adapter' });
  });

  test('rejects path traversal before invoking OPA', async () => {
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

  test('rejects malformed JSON data before invoking OPA', async () => {
    const response = await fetch(`${baseUrl}/api/v1/artifacts/opa/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: { files: { 'data.json': '{oops' } } }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Invalid JSON/);
  });
});
