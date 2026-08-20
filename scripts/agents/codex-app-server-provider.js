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

export class CodexAppServerClient {
  constructor({
    command = process.env.CODEX_BIN || 'codex',
    cwd = process.env.CODEX_CWD || process.cwd(),
    timeout = DEFAULT_TIMEOUT,
    model = process.env.CODEX_MODEL || null,
    effort = process.env.CODEX_EFFORT || 'medium',
  } = {}) {
    this.command = command;
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
      this.proc = spawn(this.command, ['app-server'], {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.proc.on('error', error => this.#failAll(error));
      this.proc.on('exit', (code, signal) => {
        if (this.started || code !== 0) {
          const suffix = this.stderr.length ? `: ${this.stderr.slice(-3).join(' | ')}` : '';
          this.#failAll(new Error(`Codex app-server exited (${code ?? signal})${suffix}`));
        }
        this.started = false;
        this.startPromise = null;
      });

      this.proc.stderr.setEncoding('utf8');
      this.proc.stderr.on('data', chunk => {
        for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
          this.stderr.push(line);
          if (this.stderr.length > 50) this.stderr.shift();
        }
      });

      this.rl = readline.createInterface({ input: this.proc.stdout });
      this.rl.on('line', line => {
        try {
          this.#handleMessage(JSON.parse(line));
        } catch (error) {
          this.#failAll(new Error(`Invalid Codex app-server message: ${error.message}`));
        }
      });

      await this.#requestRaw('initialize', {
        clientInfo: {
          name: 'bpmn_generator',
          title: 'AI BPMN Modeler',
          version: '0.1.0',
        },
      });
      this.#notify('initialized', {});
      this.started = true;
    })().catch(error => {
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

  async runTurn(text, {
    model = this.model,
    effort = this.effort,
    outputSchema = null,
    timeout = this.timeout,
  } = {}) {
    await this.start();

    const threadParams = {
      cwd: this.cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      serviceName: 'bpmn_generator',
    };
    if (model) threadParams.model = model;

    const threadResult = await this.#requestRaw('thread/start', threadParams);
    const threadId = threadResult?.thread?.id;
    if (!threadId) throw new Error('Codex app-server did not return a thread id');

    const turnParams = {
      threadId,
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
    return { threadId, turnId, text: result };
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
        resolve: result => { clearTimeout(timer); resolve(result); },
        reject: error => { clearTimeout(timer); reject(error); },
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
        pending.reject(new Error(`Codex app-server ${message.error.code ?? ''}: ${message.error.message || 'request failed'}`));
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

    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
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
        current.waiters = current.waiters.filter(w => w.resolve !== resolve);
        reject(new Error(`Codex turn timed out: ${turnId}`));
      }, timeout);
      state.waiters.push({
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
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

    const finalMessage = [...state.messages].reverse().find(m => m.phase === 'final_answer')
      || state.messages[state.messages.length - 1];
    const text = finalMessage?.text || state.delta;
    if (!text) throw new Error('Codex turn completed without an agent message');
    return text;
  }

  #resolveTurn(turnId) {
    const state = this.#getTurn(turnId);
    let value;
    let error;
    try { value = this.#turnResult(turnId); }
    catch (err) { error = err; }

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
    .filter(message => message && typeof message.content === 'string')
    .map(message => `${String(message.role || 'user').toUpperCase()}:\n${message.content}`)
    .join('\n\n');
}

export function createCodexAppServerProvider({
  client = codexAppServer,
  model = process.env.CODEX_MODEL || null,
  effort = process.env.CODEX_EFFORT || 'medium',
} = {}) {
  return async function callCodex(systemOrMessages, userPromptOrOptions, maybeOptions) {
    const { messages, options } = normalizeMessages(systemOrMessages, userPromptOrOptions, maybeOptions);
    // `json_object` means "return JSON", not "apply this Structured Output schema".
    // Passing a generic { type: 'object' } to Codex app-server is invalid under
    // strict Structured Outputs (object schemas require additionalProperties: false)
    // and would not describe the Logic-Core shape anyway. Leave outputSchema unset
    // and let the prompt + downstream schema gate validate the returned JSON.
    const outputSchema = null;

    const result = await client.runTurn(messagesToText(messages), {
      model,
      effort,
      outputSchema,
    });
    return result.text;
  };
}
