import { describe, test, expect, vi } from 'vite-plus/test';
import { fileURLToPath } from 'node:url';
import {
  CodexAppServerClient,
  createCodexAppServerProvider,
  isRecoverableThreadResumeError,
  normalizeCodexModels,
} from './agents/codex-app-server-provider.js';

const fakeAppServer = fileURLToPath(
  new URL('./fixtures/fake-codex-app-server.mjs', import.meta.url),
);

describe('createCodexAppServerProvider', () => {
  test('adapts system/user prompts to one Codex turn', async () => {
    const runTurn = vi.fn(async () => ({ text: '{"ok":true}', threadId: 'thread-1' }));
    const provider = createCodexAppServerProvider({
      client: { runTurn },
      model: 'test-model',
      effort: 'medium',
    });

    const result = await provider('System instructions', 'User request', {
      responseFormat: { type: 'json_object' },
    });

    expect(result).toBe('{"ok":true}');
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn.mock.calls[0][0]).toContain('SYSTEM:\nSystem instructions');
    expect(runTurn.mock.calls[0][0]).toContain('USER:\nUser request');
    expect(runTurn.mock.calls[0][1]).toEqual({
      threadId: null,
      model: 'test-model',
      effort: 'medium',
      outputSchema: null,
    });
  });

  test('adapts multi-turn chat history without requiring Codex binary', async () => {
    const runTurn = vi.fn(async () => ({ text: 'done', threadId: 'thread-1' }));
    const provider = createCodexAppServerProvider({
      client: { runTurn },
      model: null,
      effort: 'low',
    });

    await provider([
      { role: 'system', content: 'Review BPMN.' },
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
    ]);

    const prompt = runTurn.mock.calls[0][0];
    expect(prompt).toContain('SYSTEM:\nReview BPMN.');
    expect(prompt).toContain('ASSISTANT:\nFirst answer');
    expect(prompt).toContain('USER:\nSecond question');
    expect(runTurn.mock.calls[0][1].outputSchema).toBeNull();
  });

  test('reuses and updates the server-owned thread through a work session', async () => {
    const runTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: 'first',
        threadId: 'thread-1',
        contextReset: true,
        contextResetReason: 'stale_thread',
      })
      .mockResolvedValueOnce({ text: 'second', threadId: 'thread-1', contextReset: false });
    const session = {
      threadId: null,
      model: 'test-model',
      effort: 'high',
      contextReset: false,
      contextResetReason: null,
    };
    const provider = createCodexAppServerProvider({ client: { runTurn }, session });

    await provider('system', 'first');
    await provider('system', 'second');

    expect(runTurn.mock.calls[0][1].threadId).toBeNull();
    expect(runTurn.mock.calls[1][1].threadId).toBe('thread-1');
    expect(runTurn.mock.calls[1][1].model).toBe('test-model');
    expect(runTurn.mock.calls[1][1].effort).toBe('high');
    expect(session.threadId).toBe('thread-1');
    expect(session.contextReset).toBe(true);
    expect(session.contextResetReason).toBe('stale_thread');
  });
});

describe('Codex app-server protocol adapter', () => {
  test('uses model/list pagination and preserves advertised effort metadata', async () => {
    const client = new CodexAppServerClient({
      command: process.execPath,
      args: [fakeAppServer],
      timeout: 2_000,
    });

    try {
      const models = normalizeCodexModels(
        await client.listModels({ includeHidden: false, limit: 1 }),
      );
      expect(models.map((model) => model.model)).toEqual(['fake-default', 'fake-large']);
      expect(models[0]).toMatchObject({
        isDefault: true,
        defaultReasoningEffort: 'low',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'low reasoning' },
          { reasoningEffort: 'high', description: 'high reasoning' },
        ],
      });
    } finally {
      client.close();
    }
  });

  test('resumes an existing thread and applies model/effort on the next turn', async () => {
    const client = new CodexAppServerClient({
      command: process.execPath,
      args: [fakeAppServer],
      timeout: 2_000,
    });

    try {
      const first = await client.runTurn('first', { model: 'fake-default', effort: 'low' });
      const second = await client.runTurn('second', {
        threadId: first.threadId,
        model: 'fake-large',
        effort: 'high',
      });

      expect(second.threadId).toBe(first.threadId);
      expect(second.contextReset).toBe(false);
      expect(second.text).toContain(`thread=${String(first.threadId)}`);
      expect(second.text).toContain('model=fake-large');
      expect(second.text).toContain('effort=high');
    } finally {
      client.close();
    }
  });

  test('recovers a stale persisted thread by starting a new observable context', async () => {
    const client = new CodexAppServerClient({
      command: process.execPath,
      args: [fakeAppServer],
      timeout: 2_000,
    });

    try {
      const staleThreadId = '00000000-0000-0000-0000-000000000999';
      const result = await client.runTurn('recover', {
        threadId: staleThreadId,
        model: 'fake-default',
        effort: 'low',
      });

      expect(result.threadId).not.toBe(staleThreadId);
      expect(result.contextReset).toBe(true);
      expect(result.contextResetReason).toBe('stale_thread');
    } finally {
      client.close();
    }
  });

  test('only classifies missing thread history as recoverable', () => {
    expect(isRecoverableThreadResumeError(new Error('no rollout found for thread id abc'))).toBe(
      true,
    );
    expect(isRecoverableThreadResumeError(new Error('authentication failed'))).toBe(false);
  });
});
