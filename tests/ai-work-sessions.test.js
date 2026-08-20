import { describe, test, expect } from 'vite-plus/test';
import {
  AiWorkSessionError,
  AiWorkSessionStore,
  resolveCodexDefaults,
} from '../src/ai/ai-work-sessions.js';

const models = [
  {
    id: 'model-a',
    model: 'model-a',
    displayName: 'Model A',
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'low' },
      { reasoningEffort: 'high', description: 'high' },
    ],
  },
  {
    id: 'model-b',
    model: 'model-b',
    displayName: 'Model B',
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'medium', description: 'medium' },
      { reasoningEffort: 'high', description: 'high' },
    ],
  },
];

describe('AI work sessions', () => {
  test('uses advertised defaults when no environment override is configured', () => {
    expect(resolveCodexDefaults(models, { configuredModel: null, configuredEffort: null })).toEqual(
      { model: 'model-a', effort: 'low' },
    );
  });

  test('keeps configured environment values as bootstrap defaults', () => {
    expect(
      resolveCodexDefaults(models, {
        configuredModel: 'model-b',
        configuredEffort: 'high',
      }),
    ).toEqual({ model: 'model-b', effort: 'high' });
  });

  test('keeps the same thread metadata for repeated operations in one session', () => {
    const store = new AiWorkSessionStore();
    const session = store.prepare(
      'artifact-a',
      {},
      {
        models,
        defaults: { model: 'model-a', effort: 'low' },
      },
    );
    session.threadId = 'thread-a';

    const again = store.prepare(
      'artifact-a',
      {},
      {
        models,
        defaults: { model: 'model-a', effort: 'low' },
      },
    );
    const other = store.prepare(
      'artifact-b',
      {},
      {
        models,
        defaults: { model: 'model-a', effort: 'low' },
      },
    );

    expect(again.threadId).toBe('thread-a');
    expect(other.threadId).toBeNull();
  });

  test('model changes reset effort to that model advertised default', () => {
    const store = new AiWorkSessionStore();
    const session = store.prepare(
      'artifact-a',
      { model: 'model-a', effort: 'high' },
      { models, defaults: { model: 'model-a', effort: 'low' } },
    );
    expect(session.effort).toBe('high');

    const switched = store.prepare(
      'artifact-a',
      { model: 'model-b' },
      { models, defaults: { model: 'model-a', effort: 'low' } },
    );
    expect(switched.model).toBe('model-b');
    expect(switched.effort).toBe('medium');
  });

  test('rejects unsupported client model/effort combinations', () => {
    const store = new AiWorkSessionStore();

    expect(() =>
      store.prepare(
        'artifact-a',
        { model: 'missing-model' },
        { models, defaults: { model: 'model-a', effort: 'low' } },
      ),
    ).toThrow(AiWorkSessionError);

    expect(() =>
      store.prepare(
        'artifact-a',
        { model: 'model-a', effort: 'medium' },
        { models, defaults: { model: 'model-a', effort: 'low' } },
      ),
    ).toThrow(/not supported/);
  });

  test('reset clears only runtime context and preserves selection', () => {
    const store = new AiWorkSessionStore();
    const session = store.prepare(
      'artifact-a',
      { model: 'model-b', effort: 'high' },
      { models, defaults: { model: 'model-a', effort: 'low' } },
    );
    session.threadId = 'thread-a';

    const reset = store.reset('artifact-a');
    expect(reset.threadId).toBeNull();
    expect(reset.model).toBe('model-b');
    expect(reset.effort).toBe('high');
    expect(store.publicState(reset)).toMatchObject({
      status: 'reset',
      contextReset: true,
      contextResetReason: 'user_reset',
    });
  });

  test('public state never exposes Codex thread ids', () => {
    const store = new AiWorkSessionStore();
    const session = store.prepare(
      'artifact-a',
      {},
      {
        models,
        defaults: { model: 'model-a', effort: 'low' },
      },
    );
    session.threadId = 'secret-provider-thread-id';

    expect(store.publicState(session)).toEqual({
      id: 'artifact-a',
      status: 'continuing',
      model: 'model-a',
      effort: 'low',
      contextReset: false,
      contextResetReason: null,
    });
  });
});
