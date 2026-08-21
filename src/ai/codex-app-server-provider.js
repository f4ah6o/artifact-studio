/**
 * Codex app-server provider.
 *
 * Adapts the bidirectional Codex app-server JSON-RPC protocol to the
 * llmProvider(system, user, options) interface used by the existing agents.
 *
 * Transport: stdio JSONL (stable/default app-server transport).
 * Authentication is owned by Codex (ChatGPT managed OAuth, API key, etc.).
 */

import { spawn } from 'node:child_process';
import readline from 'node:readline';

const DEFAULT_TIMEOUT = 180_000;

function turnState() {
  return {
    messages: [],
    delta: '',
    completed: null,
    waiters: [],
  };
}

export class CodexAppServerError extends Error {
  constructor(message, { code = null, data = null, method = null } = {}) {
    super(message);
    this.name = 'CodexAppServerError';
    this.code = code;
    this.data = data;
    this.method = method;
  }
}

export function isRecoverableThreadResumeError(error) {
  const message = String(error?.message || '');
  return (
    /no rollout found for thread id/i.test(message) ||
    /thread(?: id)? .*not found/i.test(message) ||
    /unknown thread/i.test(message) ||
    /thread .*does not exist/i.test(message)
  );
}

export function normalizeCodexModels(models) {
  return (Array.isArray(models) ? models : [])
    .filter((entry) => entry && typeof entry.model === 'string' && entry.model)
    .map((entry) => ({
      id: typeof entry.id === 'string' && entry.id ? entry.id : entry.model,
      model: entry.model,
      displayName:
        typeof entry.displayName === 'string' && entry.displayName
          ? entry.displayName
          : entry.model,
      description: typeof entry.description === 'string' ? entry.description : '',
      hidden: Boolean(entry.hidden),
      isDefault: Boolean(entry.isDefault),
      defaultReasoningEffort:
        typeof entry.defaultReasoningEffort === 'string' ? entry.defaultReasoningEffort : null,
      supportedReasoningEfforts: (Array.isArray(entry.supportedReasoningEfforts)
        ? entry.supportedReasoningEfforts
        : []
      )
        .filter(
          (option) =>
            option && typeof option.reasoningEffort === 'string' && option.reasoningEffort,
        )
        .map((option) => ({
          reasoningEffort: option.reasoningEffort,
          description: typeof option.description === 'string' ? option.description : '',
        })),
    }));
}

export class CodexAppServerClient {
  constructor({
    command = process.env.CODEX_BIN || 'codex',
    args = ['app-server'],
    cwd = process.env.CODEX_CWD || process.cwd(),
    timeout = DEFAULT_TIMEOUT,
    model = process.env.CODEX_MODEL || null,
    effort = process.env.CODEX_EFFORT || null,
  } = {}) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.timeout = timeout;
    this.model = model;
    this.effort = effort;

    this.proc = null;
    this.rl = null;
    this.startPromise = null;
    this.started = false;
    this.nextId = 1;
    this.pending = new Map();
    this.turns = new Map();
    this.stderr = [];
  }

  async start() {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      this.proc = spawn(this.command, this.args, {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.proc.on('error', (error) => this.#failAll(error));
      this.proc.on('exit', (code, signal) => {
        if (this.started || code !== 0) {
          const suffix = this.stderr.length ? `: ${this.stderr.slice(-3).join(' | ')}` : '';
          this.#failAll(new Error(`Codex app-server exited (${code ?? signal})${suffix}`));
        }
        this.started = false;
        this.startPromise = null;
      });

      this.proc.stderr.setEncoding('utf8');
      this.proc.stderr.on('data', (chunk) => {
        for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
          this.stderr.push(line);
          if (this.stderr.length > 50) this.stderr.shift();
        }
      });

      this.rl = readline.createInterface({ input: this.proc.stdout });
      this.rl.on('line', (line) => {
        try {
          this.#handleMessage(JSON.parse(line));
        } catch (error) {
          this.#failAll(new Error(`Invalid Codex app-server message: ${error.message}`));
        }
      });

      await this.#requestRaw('initialize', {
        clientInfo: {
          name: 'artifact_studio',
          title: 'As-Code Studio',
          version: '0.1.0',
        },
      });
      this.#notify('initialized', {});
      this.started = true;
    })().catch((error) => {
      this.started = false;
      this.startPromise = null;
      if (this.proc && !this.proc.killed) this.proc.kill();
      throw error;
    });

    return this.startPromise;
  }

  async request(method, params = {}) {
    await this.start();
    return this.#requestRaw(method, params);
  }

  async accountRead({ refreshToken = false } = {}) {
    return this.request('account/read', { refreshToken });
  }

  async listModels({ includeHidden = false, limit = 100 } = {}) {
    const data = [];
    let cursor = null;

    do {
      const params = { includeHidden, limit };
      if (cursor) params.cursor = cursor;
      const result = await this.request('model/list', params);
      data.push(...(Array.isArray(result?.data) ? result.data : []));
      cursor = result?.nextCursor || null;
    } while (cursor);

    return data;
  }

  async loginChatGpt() {
    return this.request('account/login/start', {
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
      appBrand: 'chatgpt',
    });
  }

  async logout() {
    return this.request('account/logout', {});
  }

  async runTurn(
    text,
    {
      threadId = null,
      model = this.model,
      effort = this.effort,
      outputSchema = null,
      timeout = this.timeout,
    } = {},
  ) {
    await this.start();

    let resolvedThreadId = threadId;
    let contextReset = false;
    let contextResetReason = null;

    if (resolvedThreadId) {
      const resumeParams = {
        threadId: resolvedThreadId,
        cwd: this.cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
      };
      if (model) resumeParams.model = model;

      try {
        const resumed = await this.#requestRaw('thread/resume', resumeParams);
        resolvedThreadId = resumed?.thread?.id || resolvedThreadId;
      } catch (error) {
        if (!isRecoverableThreadResumeError(error)) throw error;
        resolvedThreadId = null;
        contextReset = true;
        contextResetReason = 'stale_thread';
      }
    }

    if (!resolvedThreadId) {
      const threadParams = {
        cwd: this.cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        serviceName: 'artifact_studio',
      };
      if (model) threadParams.model = model;

      const threadResult = await this.#requestRaw('thread/start', threadParams);
      resolvedThreadId = threadResult?.thread?.id;
      if (!resolvedThreadId) throw new Error('Codex app-server did not return a thread id');
    }

    const turnParams = {
      threadId: resolvedThreadId,
      input: [{ type: 'text', text }],
      cwd: this.cwd,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', access: { type: 'fullAccess' } },
    };
    if (model) turnParams.model = model;
    if (effort) turnParams.effort = effort;
    if (outputSchema) turnParams.outputSchema = outputSchema;

    const turnResult = await this.#requestRaw('turn/start', turnParams);
    const turnId = turnResult?.turn?.id;
    if (!turnId) throw new Error('Codex app-server did not return a turn id');

    const result = await this.#waitForTurn(turnId, timeout);
    return {
      threadId: resolvedThreadId,
      turnId,
      text: result,
      contextReset,
      contextResetReason,
    };
  }

  close() {
    if (this.rl) this.rl.close();
    if (this.proc && !this.proc.killed) this.proc.kill();
    this.proc = null;
    this.rl = null;
    this.started = false;
    this.startPromise = null;
  }

  #write(message) {
    if (!this.proc?.stdin?.writable) {
      throw new Error('Codex app-server stdin is not writable');
    }
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #notify(method, params) {
    this.#write({ method, params });
  }

  #requestRaw(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.timeout);

      this.pending.set(id, {
        method,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      try {
        this.#write({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  #getTurn(turnId) {
    if (!this.turns.has(turnId)) this.turns.set(turnId, turnState());
    return this.turns.get(turnId);
  }

  #handleMessage(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new CodexAppServerError(
            `Codex app-server ${message.error.code ?? ''}: ${message.error.message || 'request failed'}`,
            {
              code: message.error.code ?? null,
              data: message.error.data ?? null,
              method: pending.method,
            },
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    // Server-initiated JSON-RPC request. This provider is intentionally
    // read-only, so approvals are denied rather than auto-accepted.
    if (message.id !== undefined && message.method) {
      this.#handleServerRequest(message);
      return;
    }

    const { method, params = {} } = message;
    if (!method) return;

    if (method === 'item/agentMessage/delta') {
      const state = this.#getTurn(params.turnId);
      state.delta += params.delta || '';
      return;
    }

    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      const state = this.#getTurn(params.turnId);
      state.messages.push(params.item);
      return;
    }

    if (method === 'turn/completed') {
      const turn = params.turn || {};
      const state = this.#getTurn(turn.id);
      state.completed = turn;
      this.#resolveTurn(turn.id);
    }
  }

  #handleServerRequest(message) {
    const { id, method } = message;

    if (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileChange/requestApproval'
    ) {
      this.#write({ id, result: { decision: 'decline' } });
      return;
    }

    if (method === 'item/permissions/requestApproval') {
      this.#write({ id, result: { permissions: {} } });
      return;
    }

    if (method === 'mcpServer/elicitation/request') {
      this.#write({ id, result: { action: 'cancel', content: null } });
      return;
    }

    this.#write({ id, error: { code: -32601, message: `Unsupported client request: ${method}` } });
  }

  #waitForTurn(turnId, timeout) {
    const state = this.#getTurn(turnId);
    if (state.completed) return this.#turnResult(turnId);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const current = this.#getTurn(turnId);
        current.waiters = current.waiters.filter((w) => w.resolve !== resolve);
        reject(new Error(`Codex turn timed out: ${turnId}`));
      }, timeout);
      state.waiters.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  #turnResult(turnId) {
    const state = this.#getTurn(turnId);
    const turn = state.completed;
    if (!turn) return null;

    if (turn.status !== 'completed') {
      const message = turn.error?.message || `Codex turn ended with status ${turn.status}`;
      throw new Error(message);
    }

    const finalMessage =
      [...state.messages].reverse().find((m) => m.phase === 'final_answer') ||
      state.messages[state.messages.length - 1];
    const text = finalMessage?.text || state.delta;
    if (!text) throw new Error('Codex turn completed without an agent message');
    return text;
  }

  #resolveTurn(turnId) {
    const state = this.#getTurn(turnId);
    let value;
    let error;
    try {
      value = this.#turnResult(turnId);
    } catch (err) {
      error = err;
    }

    for (const waiter of state.waiters.splice(0)) {
      if (error) waiter.reject(error);
      else waiter.resolve(value);
    }
  }

  #failAll(error) {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(error);
    }
    for (const state of this.turns.values()) {
      for (const waiter of state.waiters.splice(0)) waiter.reject(error);
    }
  }
}

export const codexAppServer = new CodexAppServerClient();

function normalizeMessages(systemOrMessages, userPromptOrOptions, maybeOptions) {
  if (Array.isArray(systemOrMessages)) {
    return { messages: systemOrMessages, options: userPromptOrOptions || {} };
  }
  return {
    messages: [
      { role: 'system', content: systemOrMessages },
      { role: 'user', content: userPromptOrOptions },
    ],
    options: maybeOptions || {},
  };
}

function messagesToText(messages) {
  return messages
    .filter((message) => message && typeof message.content === 'string')
    .map((message) => `${String(message.role || 'user').toUpperCase()}:\n${message.content}`)
    .join('\n\n');
}

export function createCodexAppServerProvider({
  client = codexAppServer,
  model = process.env.CODEX_MODEL || null,
  effort = process.env.CODEX_EFFORT || null,
  session = null,
} = {}) {
  return async function callCodex(systemOrMessages, userPromptOrOptions, maybeOptions) {
    const { messages } = normalizeMessages(systemOrMessages, userPromptOrOptions, maybeOptions);
    // `json_object` means "return JSON", not "apply this Structured Output schema".
    // Passing a generic { type: 'object' } to Codex app-server is invalid under
    // strict Structured Outputs (object schemas require additionalProperties: false)
    // and would not describe the Logic-Core shape anyway. Leave outputSchema unset
    // and let the prompt + downstream schema gate validate the returned JSON.
    const outputSchema = null;

    const result = await client.runTurn(messagesToText(messages), {
      threadId: session?.threadId || null,
      model: session?.model ?? model,
      effort: session?.effort ?? effort,
      outputSchema,
    });

    if (session) {
      session.threadId = result.threadId;
      if (result.contextReset) {
        session.contextReset = true;
        session.contextResetReason = result.contextResetReason || null;
      }
    }

    return result.text;
  };
}
