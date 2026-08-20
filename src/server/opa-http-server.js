import { createServer } from 'node:http';
import {
  OpaCliError,
  OpaWorkspaceError,
  checkWorkspace,
  dependenciesWorkspace,
  evaluateWorkspace,
  formatWorkspace,
  testWorkspace,
} from '../adapters/opa.js';

const MAX_BODY_BYTES = 6 * 1024 * 1024;
const DEFAULT_PORT = Number(process.env.OPA_API_PORT || 3001);

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES)
      throw new OpaWorkspaceError(
        `Request body exceeds ${MAX_BODY_BYTES} bytes`,
        'OPA_REQUEST_TOO_LARGE',
      );
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new OpaWorkspaceError('Invalid JSON request body', 'OPA_REQUEST_INVALID');
  }
}

function errorStatus(error) {
  if (error instanceof OpaWorkspaceError) return error.code === 'OPA_REQUEST_TOO_LARGE' ? 413 : 400;
  if (error instanceof OpaCliError) {
    if (error.code === 'OPA_UNAVAILABLE') return 503;
    if (error.code === 'OPA_TIMEOUT') return 504;
    if (error.code === 'OPA_OUTPUT_LIMIT') return 413;
    return 422;
  }
  return 500;
}

function errorPayload(error) {
  return {
    status: 'error',
    code: error.code || 'OPA_INTERNAL_ERROR',
    error: error.message,
  };
}

export function createOpaHttpServer() {
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { status: 'ok', service: 'opa-adapter' });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });

    try {
      const body = await readJson(req);
      const workspace = body.workspace;
      switch (req.url) {
        case '/api/v1/artifacts/opa/check':
          return sendJson(res, 200, { status: 'success', ...(await checkWorkspace(workspace)) });
        case '/api/v1/artifacts/opa/format':
          return sendJson(res, 200, {
            status: 'success',
            workspace: await formatWorkspace(workspace),
          });
        case '/api/v1/artifacts/opa/eval':
          return sendJson(res, 200, {
            status: 'success',
            evaluation: await evaluateWorkspace(workspace, body.query, {
              input: body.input,
              explain: body.explain,
            }),
          });
        case '/api/v1/artifacts/opa/test':
          return sendJson(res, 200, { status: 'success', result: await testWorkspace(workspace) });
        case '/api/v1/artifacts/opa/deps':
          return sendJson(res, 200, {
            status: 'success',
            result: await dependenciesWorkspace(workspace, body.query),
          });
        default:
          return sendJson(res, 404, { error: 'Not Found' });
      }
    } catch (error) {
      return sendJson(res, errorStatus(error), errorPayload(error));
    }
  });
}

const server = createOpaHttpServer();
const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  server.listen(DEFAULT_PORT, '127.0.0.1', () => {
    console.log(`OPA adapter API listening on http://127.0.0.1:${DEFAULT_PORT}`);
  });
}

export { server };
