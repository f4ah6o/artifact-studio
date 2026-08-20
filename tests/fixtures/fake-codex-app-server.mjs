#!/usr/bin/env node

import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });
let threadCounter = 0;
let turnCounter = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function model(id, isDefault, defaultReasoningEffort, efforts) {
  return {
    id,
    model: id,
    displayName: id.toUpperCase(),
    description: `Fake ${id}`,
    hidden: false,
    isDefault,
    defaultReasoningEffort,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: `${reasoningEffort} reasoning`,
    })),
  };
}

rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const { id, method, params = {} } = message;

  if (method === 'initialize') {
    send({ id, result: { userAgent: 'fake-codex-app-server' } });
    return;
  }

  if (method === 'model/list') {
    if (params.cursor === 'page-2') {
      send({
        id,
        result: {
          data: [model('fake-large', false, 'medium', ['medium', 'high'])],
          nextCursor: null,
        },
      });
    } else {
      send({
        id,
        result: {
          data: [model('fake-default', true, 'low', ['low', 'high'])],
          nextCursor: 'page-2',
        },
      });
    }
    return;
  }

  if (method === 'thread/resume') {
    if (params.threadId === '00000000-0000-0000-0000-000000000999') {
      send({
        id,
        error: {
          code: -32600,
          message: `no rollout found for thread id ${params.threadId}`,
        },
      });
      return;
    }
    send({ id, result: { thread: { id: params.threadId } } });
    return;
  }

  if (method === 'thread/start') {
    threadCounter += 1;
    const threadId = `00000000-0000-0000-0000-${String(threadCounter).padStart(12, '0')}`;
    send({ id, result: { thread: { id: threadId } } });
    return;
  }

  if (method === 'turn/start') {
    turnCounter += 1;
    const turnId = `turn-${turnCounter}`;
    send({ id, result: { turn: { id: turnId } } });
    queueMicrotask(() => {
      send({
        method: 'item/completed',
        params: {
          turnId,
          item: {
            type: 'agentMessage',
            phase: 'final_answer',
            text: `thread=${params.threadId};model=${params.model || ''};effort=${params.effort || ''}`,
          },
        },
      });
      send({ method: 'turn/completed', params: { turn: { id: turnId, status: 'completed' } } });
    });
    return;
  }

  send({ id, error: { code: -32601, message: `Unsupported fake method: ${method}` } });
});
