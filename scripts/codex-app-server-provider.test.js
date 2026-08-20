import { describe, test, expect, jest } from '@jest/globals';
import { createCodexAppServerProvider } from './agents/codex-app-server-provider.js';

describe('createCodexAppServerProvider', () => {
  test('adapts system/user prompts to one Codex turn', async () => {
    const runTurn = jest.fn(async () => ({ text: '{"ok":true}' }));
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
      model: 'test-model',
      effort: 'medium',
      outputSchema: null,
    });
  });

  test('adapts multi-turn chat history without requiring Codex binary', async () => {
    const runTurn = jest.fn(async () => ({ text: 'done' }));
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
});
