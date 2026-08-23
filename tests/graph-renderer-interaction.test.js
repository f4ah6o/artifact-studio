import { describe, expect, test } from 'vite-plus/test';
import { bindGraphProjectionNodes } from '../src/client/graph-renderer.js';

function fakeElement() {
  const listeners = new Map();
  const classes = new Set();
  const attributes = new Map();
  return {
    dataset: {},
    classList: { add: (...values) => values.forEach((value) => classes.add(value)) },
    setAttribute: (name, value) => attributes.set(name, value),
    addEventListener: (type, listener) => listeners.set(type, listener),
    emit(type, event = {}) {
      listeners.get(type)?.({ preventDefault() {}, ...event });
    },
    classes,
    attributes,
  };
}

describe('GraphProjection interactive renderer binding', () => {
  test('maps Mermaid-generated node indexes back to canonical graph node ids', () => {
    const first = fakeElement();
    const second = fakeElement();
    const target = {
      querySelector(selector) {
        if (selector.includes('-flowchart-n0-')) return first;
        if (selector.includes('-flowchart-n1-')) return second;
        return null;
      },
    };
    const projection = {
      nodes: [
        { id: 'entity-a', label: 'A' },
        { id: 'entity-b', label: 'B' },
      ],
      edges: [],
    };
    const activated = [];

    bindGraphProjectionNodes(projection, target, (node) => activated.push(node.id));

    expect(first.dataset.graphNodeId).toBe('entity-a');
    expect(second.dataset.graphNodeId).toBe('entity-b');
    expect(first.classes.has('graph-projection-node-interactive')).toBe(true);
    expect(first.attributes.get('role')).toBe('button');
    expect(first.attributes.get('tabindex')).toBe('0');
    first.emit('click');
    second.emit('keydown', { key: 'Enter' });
    expect(activated).toEqual(['entity-a', 'entity-b']);
  });
});
