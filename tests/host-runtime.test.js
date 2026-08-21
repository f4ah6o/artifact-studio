import { describe, expect, test, vi } from 'vite-plus/test';
import {
  HostRuntimeError,
  createBrowserHttpHostRuntime,
  setHostRuntime,
} from '../src/client/host-runtime.js';

function response({ ok = true, status = 200, statusText = 'OK', data = {} } = {}) {
  return {
    ok,
    status,
    statusText,
    async json() {
      return data;
    },
  };
}

describe('browser HostRuntime', () => {
  test('routes config and adapter actions through the host boundary', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ data: { studio: { enabledAdapters: ['dagu'] } } }))
      .mockResolvedValueOnce(response({ data: { ok: true } }));
    const runtime = createBrowserHttpHostRuntime({ fetchImpl });

    await expect(runtime.getConfig()).resolves.toEqual({ studio: { enabledAdapters: ['dagu'] } });
    await expect(runtime.artifactAction('dagu', 'check', { source: 'steps: []' })).resolves.toEqual(
      {
        ok: true,
      },
    );

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/v1/config', { method: 'GET' });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/v1/artifacts/dagu/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'steps: []' }),
    });
  });

  test('normalizes HTTP errors without leaking fetch handling into adapters', async () => {
    const runtime = createBrowserHttpHostRuntime({
      fetchImpl: vi.fn().mockResolvedValue(
        response({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          data: { error: 'invalid workflow', code: 'DAGU_INVALID' },
        }),
      ),
    });

    await expect(runtime.post('/api/example', {})).rejects.toMatchObject({
      name: 'HostRuntimeError',
      message: 'invalid workflow',
      code: 'DAGU_INVALID',
      status: 422,
    });
  });

  test('rejects invalid runtime injection', () => {
    expect(() => setHostRuntime({})).toThrow(TypeError);
    expect(new HostRuntimeError('x')).toBeInstanceOf(Error);
  });
});
