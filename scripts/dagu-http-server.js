import { createServer } from 'node:http';
import { GraphProjectionError } from '../shared/graph-projection.js';
import {
  DaguCliError,
  DaguSourceError,
  daguGraphProjection,
  daguRuntimeCapabilities,
  validateDaguSource,
} from './artifacts/dagu.js';

const MAX_BODY_BYTES = 3 * 1024 * 1024;
const DEFAULT_PORT = Number(process.env.DAGU_API_PORT || 3002);

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
    if (bytes > MAX_BODY_BYTES) {
      throw new DaguSourceError(
        `Request body exceeds ${MAX_BODY_BYTES} bytes`,
        'DAGU_REQUEST_TOO_LARGE',
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new DaguSourceError('Invalid JSON request body', 'DAGU_REQUEST_INVALID');
  }
}

function errorStatus(error) {
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

function errorPayload(error) {
  return {
    status: 'error',
    code: error.code || 'DAGU_INTERNAL_ERROR',
    error: error.message,
  };
}

export function createDaguHttpServer() {
  return createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, { status: 'ok', service: 'dagu-adapter' });
    }
    if (req.method === 'GET' && req.url === '/api/v1/artifacts/dagu/capabilities') {
      try {
        return sendJson(res, 200, {
          status: 'success',
          capabilities: await daguRuntimeCapabilities(),
        });
      } catch (error) {
        return sendJson(res, errorStatus(error), errorPayload(error));
      }
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method Not Allowed' });

    try {
      const body = await readJson(req);
      const source = body.source;
      switch (req.url) {
        case '/api/v1/artifacts/dagu/project':
          return sendJson(res, 200, {
            status: 'success',
            graph: daguGraphProjection(source),
          });
        case '/api/v1/artifacts/dagu/check':
          return sendJson(res, 200, {
            status: 'success',
            ...(await validateDaguSource(source)),
          });
        default:
          return sendJson(res, 404, { error: 'Not Found' });
      }
    } catch (error) {
      return sendJson(res, errorStatus(error), errorPayload(error));
    }
  });
}

const server = createDaguHttpServer();
const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  server.listen(DEFAULT_PORT, '127.0.0.1', () => {
    console.log(`Dagu adapter API listening on http://127.0.0.1:${DEFAULT_PORT}`);
  });
}

export { server };
