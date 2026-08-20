import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test';
import { createDaguHttpServer } from './dagu-http-server.js';

let server;
let baseUrl;
let previousBinary;

beforeEach(async () => {
  previousBinary = process.env.DAGU_BINARY;
  process.env.DAGU_BINARY = 'artifact-studio-definitely-missing-dagu-binary';
  server = createDaguHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (previousBinary == null) delete process.env.DAGU_BINARY;
  else process.env.DAGU_BINARY = previousBinary;
});

describe('Dagu adapter HTTP server', () => {
  test('reports health independently from the Dagu binary', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'dagu-adapter' });
  });

  test('reports runtime validation unavailable while keeping projection available', async () => {
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
  });

  test('projects dependencies without requiring a Dagu binary', async () => {
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

  test('returns 503 when authoritative validation is unavailable', async () => {
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
  });
});
