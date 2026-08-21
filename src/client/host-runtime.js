export class HostRuntimeError extends Error {
  constructor(message, { code = null, status = null, details = null } = {}) {
    super(message);
    this.name = 'HostRuntimeError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createBrowserHttpHostRuntime({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');

  async function requestJson(path, { method = 'POST', body } = {}) {
    const options = { method };
    if (body !== undefined) {
      options.headers = { 'content-type': 'application/json' };
      options.body = JSON.stringify(body);
    }

    const response = await fetchImpl(path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = Array.isArray(data.errors)
        ? data.errors.map((error) => `${error.path || '(root)'}: ${error.message}`).join('; ')
        : null;
      const summary = data.error || data.status || `${response.status} ${response.statusText}`;
      throw new HostRuntimeError(details ? `${summary}: ${details}` : summary, {
        code: data.code || null,
        status: response.status,
        details: data,
      });
    }
    return data;
  }

  return Object.freeze({
    kind: 'browser-http',
    requestJson,
    getConfig() {
      return requestJson('/api/v1/config', { method: 'GET' });
    },
    post(path, body = {}) {
      return requestJson(path, { method: 'POST', body });
    },
    artifactAction(adapterId, action, body = {}, { method = 'POST' } = {}) {
      return requestJson(
        `/api/v1/artifacts/${encodeURIComponent(adapterId)}/${encodeURIComponent(action)}`,
        {
          method,
          body: method === 'GET' ? undefined : body,
        },
      );
    },
  });
}

let currentHostRuntime = null;

export function hostRuntime() {
  currentHostRuntime ||= createBrowserHttpHostRuntime();
  return currentHostRuntime;
}

export function setHostRuntime(runtime) {
  if (!runtime || typeof runtime.post !== 'function' || typeof runtime.getConfig !== 'function') {
    throw new TypeError('invalid host runtime');
  }
  currentHostRuntime = runtime;
  return currentHostRuntime;
}
