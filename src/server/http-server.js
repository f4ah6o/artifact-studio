import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(__dirname, '..', '..');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

import { runPipeline, validateLogicCore } from '../bpmn/pipeline.js';
import { bpmnToLogicCore } from '../bpmn/import.js';
import { orchestrate } from '../ai/orchestrator.js';
import { chatAgent } from '../ai/chat.js';
import {
  codexAppServer,
  createCodexAppServerProvider,
  normalizeCodexModels,
} from '../ai/codex-app-server-provider.js';
import { AiWorkSessionStore, resolveCodexDefaults } from '../ai/ai-work-sessions.js';
import { deliver } from './delivery.js';
import { auditLog } from './audit.js';
import { validateLogicCoreSchema } from '../bpmn/schema-gate.js';
import { resolveStudioConfig } from './studio-config.js';
import { generateMermaidArtifact } from '../adapters/mermaid.js';
import { AS_CODE_STUDIO_VERSION } from '../version.js';
import { handleArtifactHttpRequest, isArtifactHttpRoute } from './artifact-http-routes.js';

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.BPMN_API_KEY || null; // protects this HTTP app, unrelated to Codex auth
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB
const RATE_LIMIT = { windowMs: 60_000, max: 30 };
const rateBuckets = new Map();
const startTime = Date.now();
const aiWorkSessions = new AiWorkSessionStore();

export function startupCheck(env, logger = console.warn) {
  if (env.NODE_ENV === 'production' && !env.BPMN_API_KEY) {
    throw new Error(
      'Refusing to start in production without BPMN_API_KEY. ' +
        'Set BPMN_API_KEY=<secret> or unset NODE_ENV for dev mode.',
    );
  }
  if (!env.BPMN_API_KEY) {
    logger('⚠️  Starting with no BPMN API key — dev mode only. Set BPMN_API_KEY for production.');
  }
}

export function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        return reject(new Error(`Request body exceeds ${MAX_BODY_SIZE} bytes`));
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function validateCallbackUrl(url) {
  const u = new URL(url); // throws on invalid URL
  if (!['http:', 'https:'].includes(u.protocol)) {
    return 'callbackUrl must use http or https';
  }
  if (isInternalHost(u.hostname)) {
    return 'callbackUrl must not target internal networks';
  }
  return null; // valid
}

export function isInternalHost(host) {
  // IPv4
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host.startsWith('169.254.')) return true; // link-local + AWS metadata
  // IPv6
  if (host === '::1') return true;
  // Strip brackets if URL passed them through (e.g., [fc00::1] → fc00::1)
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::1') return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true; // fc00::/7 (ULA)
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true; // fe80::/10 (link-local)
  return false;
}

// Swappable DNS lookup (overridable in tests via _setDnsLookup).
let _lookup = dnsLookup;
export function _setDnsLookup(fn) {
  _lookup = fn || dnsLookup;
}

export async function validateCallbackUrlAsync(url) {
  const sync = validateCallbackUrl(url);
  if (sync) return sync;
  const { hostname } = new URL(url);
  // Strip brackets for IPv6 hostnames
  const h = hostname.replace(/^\[|\]$/g, '');
  // If hostname is already an IP, the sync check already covered it.
  if (/^[\d.]+$/.test(h) || /:/.test(h)) return null;
  try {
    const addrs = await _lookup(hostname, { all: true });
    for (const { address } of addrs) {
      if (isInternalHost(address)) {
        return 'callbackUrl resolves to internal network';
      }
    }
  } catch (err) {
    return `callbackUrl DNS lookup failed: ${err.code || err.message}`;
  }
  return null;
}

function checkAuth(req, res) {
  if (!API_KEY) return true;
  if (req.headers['x-api-key'] !== API_KEY) {
    json(res, 401, { error: 'Invalid API key' });
    return false;
  }
  return true;
}

function checkRateLimit(req, res) {
  const ip = req.socket.remoteAddress;
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, start: now };
  if (now - bucket.start > RATE_LIMIT.windowMs) {
    bucket.count = 0;
    bucket.start = now;
  }
  bucket.count++;
  rateBuckets.set(ip, bucket);
  if (bucket.count > RATE_LIMIT.max) {
    json(res, 429, { error: 'Rate limit exceeded' });
    return false;
  }
  return true;
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export async function getCodexStatus({ client = codexAppServer, env = process.env } = {}) {
  try {
    const result = await client.accountRead({ refreshToken: false });
    const account = result?.account || null;
    const models = normalizeCodexModels(
      await client.listModels({ includeHidden: false, limit: 100 }),
    ).filter((model) => !model.hidden);
    const defaults = resolveCodexDefaults(models, {
      configuredModel: env.CODEX_MODEL || null,
      configuredEffort: env.CODEX_EFFORT || null,
    });
    return {
      available: true,
      authenticated: Boolean(account) || result?.requiresOpenaiAuth === false,
      accountType: account?.type || null,
      planType: account?.planType || null,
      model: defaults.model,
      effort: defaults.effort,
      models,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      authenticated: false,
      accountType: null,
      planType: null,
      model: env.CODEX_MODEL || null,
      effort: env.CODEX_EFFORT || null,
      models: [],
      error: error.message,
    };
  }
}

async function prepareAiRequest(body) {
  const aiSessionId =
    typeof body.aiSessionId === 'string' && body.aiSessionId
      ? body.aiSessionId
      : crypto.randomUUID();
  const models = normalizeCodexModels(
    await codexAppServer.listModels({ includeHidden: false, limit: 100 }),
  ).filter((model) => !model.hidden);
  const defaults = resolveCodexDefaults(models, {
    configuredModel: process.env.CODEX_MODEL || null,
    configuredEffort: process.env.CODEX_EFFORT || null,
  });
  const selection = {};
  if (typeof body.model === 'string' && body.model) selection.model = body.model;
  if (typeof body.effort === 'string' && body.effort) selection.effort = body.effort;
  const session = aiWorkSessions.prepare(aiSessionId, selection, { models, defaults });
  const llmProvider = createCodexAppServerProvider({ session });
  return { session, llmProvider };
}

function publicAiSession(session) {
  return aiWorkSessions.publicState(session);
}

const server = createServer(async (req, res) => {
  const { method, url } = req;

  // Health
  if (method === 'GET' && url === '/health') {
    return json(res, 200, {
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: AS_CODE_STUDIO_VERSION,
    });
  }

  // Config (frontend bootstrap — Codex owns LLM authentication).
  if (method === 'GET' && url === '/api/v1/config') {
    return json(res, 200, {
      codex: await getCodexStatus(),
      studio: resolveStudioConfig(process.env),
    });
  }

  // Frontend static files
  if (method === 'GET' && (url === '/' || url === '/index.html')) {
    const body = readFileSync(join(frontendDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(body);
  }
  if (method === 'GET' && (url === '/app.js' || url === '/styles.css')) {
    const file = url.slice(1);
    const path = join(frontendDir, file);
    try {
      const body = readFileSync(path);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      return res.end(body);
    } catch {
      return res.writeHead(404).end();
    }
  }
  // Legacy static route kept for compatibility with older bookmarks/builds.
  if (method === 'GET' && url.startsWith('/static/')) {
    const file = url.replace('/static/', '');
    const path = join(frontendDir, file);
    if (!path.startsWith(frontendDir)) return res.writeHead(403).end(); // path traversal guard
    try {
      const body = readFileSync(path);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      return res.end(body);
    } catch {
      return res.writeHead(404).end();
    }
  }
  if (method === 'GET' && url.startsWith('/examples/')) {
    const file = url.replace('/examples/', '');
    const path = join(frontendDir, 'examples', file);
    if (!path.startsWith(join(frontendDir, 'examples'))) return res.writeHead(403).end();
    try {
      const body = readFileSync(path);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      return res.end(body);
    } catch {
      return res.writeHead(404).end();
    }
  }

  // Auth + rate limiting (skip for health/config/static files)
  if (!checkAuth(req, res)) return;
  if (!checkRateLimit(req, res)) return;

  // Artifact adapter actions share the main HTTP boundary. Each adapter route
  // keeps its own request limits and runtime-specific error mapping.
  if (isArtifactHttpRoute(url)) return handleArtifactHttpRequest(req, res);

  // Only POST for API endpoints
  if (method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const correlationId = body.correlationId || crypto.randomUUID();
  const clientId = body.clientId || 'anonymous';
  const t0 = Date.now();

  try {
    // Codex managed ChatGPT login. Intended for single-user/local MVP.
    if (url === '/api/v1/codex/login') {
      const result = await codexAppServer.loginChatGpt();
      return json(res, 200, {
        status: 'login_started',
        loginId: result?.loginId || null,
        authUrl: result?.authUrl || null,
      });
    }

    if (url === '/api/v1/codex/logout') {
      await codexAppServer.logout();
      return json(res, 200, { status: 'logged_out' });
    }

    if (url === '/api/v1/ai/session/status') {
      if (typeof body.aiSessionId !== 'string' || !body.aiSessionId) {
        return json(res, 400, { error: 'aiSessionId is required' });
      }
      const { session } = await prepareAiRequest(body);
      return json(res, 200, { aiSession: publicAiSession(session) });
    }

    if (url === '/api/v1/ai/session/reset') {
      if (typeof body.aiSessionId !== 'string' || !body.aiSessionId) {
        return json(res, 400, { error: 'aiSessionId is required' });
      }
      const { session } = await prepareAiRequest(body);
      aiWorkSessions.reset(session.id);
      return json(res, 200, { aiSession: publicAiSession(session) });
    }

    // Generate
    if (url === '/api/v1/generate') {
      auditLog({ event: 'request', correlationId, clientId, endpoint: '/generate' });
      const schemaCheck = validateLogicCoreSchema(body.logicCore);
      if (!schemaCheck.valid) {
        auditLog({
          event: 'schema_rejected',
          correlationId,
          clientId,
          endpoint: '/generate',
          errorCount: schemaCheck.errors.length,
        });
        return json(res, 400, {
          correlationId,
          status: 'schema_error',
          errors: schemaCheck.errors,
        });
      }
      const result = await runPipeline(body.logicCore, { visualRefinement: body.visualRefinement });
      const durationMs = Date.now() - t0;
      const hasErrors = result.validation.errors.length > 0;
      auditLog({ event: 'completed', correlationId, durationMs, hasErrors });

      const payload = {
        correlationId,
        status: hasErrors ? 'validation_error' : 'success',
        bpmnXml: result.bpmnXml,
        svg: result.svg,
        validation: result.validation,
      };

      let callbackStatus = 'not_requested';
      if (body.callbackUrl) {
        let urlError;
        try {
          urlError = await validateCallbackUrlAsync(body.callbackUrl);
        } catch {
          return json(res, 400, { error: 'callbackUrl is not a valid URL' });
        }
        if (urlError) return json(res, 400, { error: urlError });
        deliver(body.callbackUrl, payload).catch((err) => {
          auditLog({ event: 'delivery_failed', correlationId, error: err.message });
        });
        callbackStatus = 'pending';
      }

      return json(res, 200, { ...payload, callbackStatus });
    }

    // Validate
    if (url === '/api/v1/validate') {
      auditLog({ event: 'request', correlationId, clientId, endpoint: '/validate' });
      const schemaCheck = validateLogicCoreSchema(body.logicCore);
      if (!schemaCheck.valid) {
        auditLog({
          event: 'schema_rejected',
          correlationId,
          clientId,
          endpoint: '/validate',
          errorCount: schemaCheck.errors.length,
        });
        return json(res, 400, {
          correlationId,
          status: 'schema_error',
          errors: schemaCheck.errors,
        });
      }
      const validation = validateLogicCore(body.logicCore);
      const durationMs = Date.now() - t0;
      auditLog({
        event: 'completed',
        correlationId,
        durationMs,
        hasErrors: validation.errors.length > 0,
      });
      return json(res, 200, { correlationId, status: 'success', validation });
    }

    // Import
    if (url === '/api/v1/import') {
      auditLog({ event: 'request', correlationId, clientId, endpoint: '/import' });
      const logicCore = await bpmnToLogicCore(body.bpmnXml);
      const durationMs = Date.now() - t0;
      auditLog({ event: 'completed', correlationId, durationMs });
      return json(res, 200, { correlationId, status: 'success', logicCore });
    }

    // Mermaid artifact generation — source-only output, rendered and validated in the browser.
    if (url === '/api/v1/artifacts/mermaid/generate') {
      auditLog({
        event: 'request',
        correlationId,
        clientId,
        endpoint: '/artifacts/mermaid/generate',
      });
      if (typeof body.userText !== 'string' || !body.userText.trim()) {
        return json(res, 400, { error: 'Provide userText (string)' });
      }

      const ai = await prepareAiRequest(body);
      const result = await generateMermaidArtifact({
        userText: body.userText,
        llmProvider: ai.llmProvider,
      });
      const durationMs = Date.now() - t0;
      auditLog({ event: 'completed', correlationId, durationMs, artifact: 'mermaid' });
      return json(res, 200, {
        correlationId,
        status: 'success',
        source: result.source,
        aiSession: publicAiSession(ai.session),
      });
    }

    // Orchestrate — Codex app-server is the only AI runtime for the web app.
    if (url === '/api/v1/orchestrate') {
      auditLog({ event: 'request', correlationId, clientId, endpoint: '/orchestrate' });

      const ai = await prepareAiRequest(body);
      const options = {
        ruleProfile: body.ruleProfile || null,
        llmProvider: ai.llmProvider,
      };

      const input = body.userText || body.logicCore;
      if (!input) {
        return json(res, 400, { error: 'Provide userText (string) or logicCore (object)' });
      }

      if (body.logicCore) {
        const schemaCheck = validateLogicCoreSchema(body.logicCore);
        if (!schemaCheck.valid) {
          auditLog({
            event: 'schema_rejected',
            correlationId,
            clientId,
            endpoint: '/orchestrate',
            errorCount: schemaCheck.errors.length,
          });
          return json(res, 400, {
            correlationId,
            status: 'schema_error',
            errors: schemaCheck.errors,
          });
        }
      }

      const result = await orchestrate(input, options);
      const durationMs = Date.now() - t0;
      auditLog({
        event: 'completed',
        correlationId,
        durationMs,
        isCompliant: result.compliance?.isCompliant,
      });

      return json(res, 200, {
        correlationId,
        status: 'success',
        logicCore: result.logicCore,
        bpmnXml: result.bpmnXml,
        svg: result.svg,
        validation: result.validation,
        compliance: result.compliance,
        history: result.history,
        iterations: result.iterations,
        aiSession: publicAiSession(ai.session),
      });
    }

    // Chat (discovery/grilling) through Codex app-server.
    if (url === '/api/v1/chat') {
      auditLog({ event: 'request', correlationId, clientId, endpoint: '/chat' });

      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return json(res, 400, { error: 'messages must be a non-empty array' });
      }

      const ai = await prepareAiRequest(body);
      const result = await chatAgent({ messages: body.messages, llmProvider: ai.llmProvider });
      const durationMs = Date.now() - t0;
      auditLog({
        event: 'completed',
        correlationId,
        durationMs,
        readyToGenerate: result.readyToGenerate,
      });

      return json(res, 200, {
        ...result,
        correlationId,
        aiSession: publicAiSession(ai.session),
      });
    }

    // Telemetry
    if (url === '/api/v1/telemetry') {
      try {
        auditLog({
          ts: new Date().toISOString(),
          event: 'frontend_event',
          frontendEvent: body.event,
          diagramId: body.diagramId,
          correlationId: body.correlationId,
          details: body.details,
        });
        return json(res, 200, { status: 'ok' });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }

    return json(res, 404, { error: 'Not Found' });
  } catch (err) {
    auditLog({ event: 'error', correlationId, error: err.message });
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    return json(res, statusCode, {
      correlationId,
      status: statusCode >= 500 ? 'internal_error' : 'request_error',
      error: err.message,
    });
  }
});

// Only listen when this module is the entry point. When imported by tests
// (or other modules) it stays inert — prevents EADDRINUSE under Jest workers.
const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  startupCheck(process.env);
  server.listen(PORT, () => {
    console.log(`As-Code Studio HTTP API listening on port ${PORT}`);
    console.log(`  POST /api/v1/generate    — Logic-Core → BPMN + SVG`);
    console.log(`  POST /api/v1/validate    — Logic-Core → Validation`);
    console.log(`  POST /api/v1/import      — BPMN XML → Logic-Core`);
    console.log(`  /api/v1/artifacts/*      — Artifact adapter actions`);
    console.log(`  POST /api/v1/orchestrate — Codex-assisted review + generate + compliance`);
    console.log(`  POST /api/v1/chat        — Codex discovery / grilling`);
    console.log(`  POST /api/v1/codex/login — Start managed ChatGPT login`);
    console.log(`  POST /api/v1/ai/session/reset — Reset the current AI work session`);
    console.log(`  GET  /health             — Health check`);
    console.log(`  GET  /api/v1/config      — Codex/auth bootstrap status`);
  });
}

export { server };
