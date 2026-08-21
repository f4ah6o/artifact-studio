import { GraphProjectionError } from '../core/graph-projection.js';
import {
  BonitaBdmSourceError,
  bonitaBdmGraphProjection,
  inspectBonitaBdm,
  validateBonitaBdmSource,
} from '../adapters/bonita-bdm.js';
import {
  DaguCliError,
  DaguSourceError,
  daguGraphProjection,
  daguRuntimeCapabilities,
  validateDaguSource,
} from '../adapters/dagu.js';
import {
  OpaCliError,
  OpaWorkspaceError,
  checkWorkspace,
  dependenciesWorkspace,
  evaluateWorkspace,
  formatWorkspace,
  testWorkspace,
} from '../adapters/opa.js';

const OPA_MAX_BODY_BYTES = 6 * 1024 * 1024;
const DAGU_MAX_BODY_BYTES = 3 * 1024 * 1024;
const BONITA_BDM_MAX_BODY_BYTES = 5 * 1024 * 1024;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJson(req, maxBytes, tooLargeError, invalidError) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw tooLargeError(maxBytes);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw invalidError();
  }
}

function opaErrorStatus(error) {
  if (error instanceof OpaWorkspaceError) return error.code === 'OPA_REQUEST_TOO_LARGE' ? 413 : 400;
  if (error instanceof OpaCliError) {
    if (error.code === 'OPA_UNAVAILABLE') return 503;
    if (error.code === 'OPA_TIMEOUT') return 504;
    if (error.code === 'OPA_OUTPUT_LIMIT') return 413;
    return 422;
  }
  return 500;
}

function bonitaBdmErrorStatus(error) {
  if (error instanceof BonitaBdmSourceError) {
    return error.code === 'BONITA_BDM_SOURCE_TOO_LARGE' ||
      error.code === 'BONITA_BDM_REQUEST_TOO_LARGE'
      ? 413
      : 400;
  }
  if (error instanceof GraphProjectionError) return 422;
  return 500;
}

function daguErrorStatus(error) {
  if (error instanceof DaguSourceError) {
    return error.code === 'DAGU_REQUEST_TOO_LARGE' || error.code === 'DAGU_SOURCE_TOO_LARGE'
      ? 413
      : 400;
  }
  if (error instanceof GraphProjectionError) return 422;
  if (error instanceof DaguCliError) {
    if (error.code === 'DAGU_UNAVAILABLE') return 503;
    if (error.code === 'DAGU_TIMEOUT') return 504;
    if (error.code === 'DAGU_OUTPUT_LIMIT') return 413;
    return 422;
  }
  return 500;
}

function errorPayload(error, fallbackCode) {
  return {
    status: 'error',
    code: error.code || fallbackCode,
    error: error.message,
  };
}

async function handleOpaRequest(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = await readJson(
      req,
      OPA_MAX_BODY_BYTES,
      (maxBytes) =>
        new OpaWorkspaceError(`Request body exceeds ${maxBytes} bytes`, 'OPA_REQUEST_TOO_LARGE'),
      () => new OpaWorkspaceError('Invalid JSON request body', 'OPA_REQUEST_INVALID'),
    );
    const workspace = body.workspace;
    switch (req.url) {
      case '/api/v1/artifacts/opa/check':
        sendJson(res, 200, { status: 'success', ...(await checkWorkspace(workspace)) });
        return;
      case '/api/v1/artifacts/opa/format':
        sendJson(res, 200, { status: 'success', workspace: await formatWorkspace(workspace) });
        return;
      case '/api/v1/artifacts/opa/eval':
        sendJson(res, 200, {
          status: 'success',
          evaluation: await evaluateWorkspace(workspace, body.query, {
            input: body.input,
            explain: body.explain,
          }),
        });
        return;
      case '/api/v1/artifacts/opa/test':
        sendJson(res, 200, { status: 'success', result: await testWorkspace(workspace) });
        return;
      case '/api/v1/artifacts/opa/deps':
        sendJson(res, 200, {
          status: 'success',
          result: await dependenciesWorkspace(workspace, body.query),
        });
        return;
      default:
        sendJson(res, 404, { error: 'Not Found' });
    }
  } catch (error) {
    sendJson(res, opaErrorStatus(error), errorPayload(error, 'OPA_INTERNAL_ERROR'));
  }
}

async function handleDaguRequest(req, res) {
  if (req.method === 'GET' && req.url === '/api/v1/artifacts/dagu/capabilities') {
    try {
      sendJson(res, 200, {
        status: 'success',
        capabilities: await daguRuntimeCapabilities(),
      });
    } catch (error) {
      sendJson(res, daguErrorStatus(error), errorPayload(error, 'DAGU_INTERNAL_ERROR'));
    }
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = await readJson(
      req,
      DAGU_MAX_BODY_BYTES,
      (maxBytes) =>
        new DaguSourceError(`Request body exceeds ${maxBytes} bytes`, 'DAGU_REQUEST_TOO_LARGE'),
      () => new DaguSourceError('Invalid JSON request body', 'DAGU_REQUEST_INVALID'),
    );
    const source = body.source;
    switch (req.url) {
      case '/api/v1/artifacts/dagu/project':
        sendJson(res, 200, { status: 'success', graph: daguGraphProjection(source) });
        return;
      case '/api/v1/artifacts/dagu/check':
        sendJson(res, 200, { status: 'success', ...(await validateDaguSource(source)) });
        return;
      default:
        sendJson(res, 404, { error: 'Not Found' });
    }
  } catch (error) {
    sendJson(res, daguErrorStatus(error), errorPayload(error, 'DAGU_INTERNAL_ERROR'));
  }
}

async function handleBonitaBdmRequest(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = await readJson(
      req,
      BONITA_BDM_MAX_BODY_BYTES,
      (maxBytes) =>
        new BonitaBdmSourceError(
          `Request body exceeds ${maxBytes} bytes`,
          'BONITA_BDM_REQUEST_TOO_LARGE',
        ),
      () => new BonitaBdmSourceError('Invalid JSON request body', 'BONITA_BDM_REQUEST_INVALID'),
    );
    const source = body.source;
    switch (req.url) {
      case '/api/v1/artifacts/bonita-bdm/check':
        sendJson(res, 200, { status: 'success', ...validateBonitaBdmSource(source) });
        return;
      case '/api/v1/artifacts/bonita-bdm/inspect':
        sendJson(res, 200, { status: 'success', model: inspectBonitaBdm(source) });
        return;
      case '/api/v1/artifacts/bonita-bdm/project':
        sendJson(res, 200, { status: 'success', graph: bonitaBdmGraphProjection(source) });
        return;
      default:
        sendJson(res, 404, { error: 'Not Found' });
    }
  } catch (error) {
    sendJson(res, bonitaBdmErrorStatus(error), errorPayload(error, 'BONITA_BDM_INTERNAL_ERROR'));
  }
}

export function isArtifactHttpRoute(url = '') {
  return (
    url.startsWith('/api/v1/artifacts/opa/') ||
    url.startsWith('/api/v1/artifacts/dagu/') ||
    url.startsWith('/api/v1/artifacts/bonita-bdm/')
  );
}

export async function handleArtifactHttpRequest(req, res) {
  if (req.url.startsWith('/api/v1/artifacts/opa/')) {
    await handleOpaRequest(req, res);
    return;
  }
  if (req.url.startsWith('/api/v1/artifacts/dagu/')) {
    await handleDaguRequest(req, res);
    return;
  }
  if (req.url.startsWith('/api/v1/artifacts/bonita-bdm/')) {
    await handleBonitaBdmRequest(req, res);
    return;
  }
  sendJson(res, 404, { error: 'Not Found' });
}
