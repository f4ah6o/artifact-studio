import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vite-plus/test';
import { BpmnSemanticSourceError, bpmnSemanticEntities } from '../../src/adapters/bpmn.js';

const SIMPLE_APPROVAL = readFileSync(
  new URL('../fixtures/simple-approval.expected.bpmn', import.meta.url),
  'utf8',
);
const EXPANDED_SUBPROCESS = readFileSync(
  new URL('../fixtures/expanded-subprocess.expected.bpmn', import.meta.url),
  'utf8',
);

describe('BPMN SemanticEntity provider', () => {
  test('exposes stable BPMN model element IDs without DI elements', async () => {
    const entities = await bpmnSemanticEntities(SIMPLE_APPROVAL, 'artifact-bpmn');

    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bpmn:Process_Main',
          artifactId: 'artifact-bpmn',
          kind: 'process',
          label: 'Process_Main',
          address: '#Process_Main',
          metadata: { bpmnType: 'bpmn:Process' },
        }),
        expect.objectContaining({
          id: 'bpmn:Participant_Process_Main',
          kind: 'participant',
          label: 'Main Pool',
          address: '#Participant_Process_Main',
        }),
        expect.objectContaining({
          id: 'bpmn:lane1',
          kind: 'lane',
          label: 'Default Lane',
          metadata: expect.objectContaining({ parentId: 'Process_Main' }),
        }),
        expect.objectContaining({
          id: 'bpmn:task1',
          kind: 'activity',
          label: 'Review Document',
          address: '#task1',
          metadata: {
            bpmnType: 'bpmn:UserTask',
            parentId: 'Process_Main',
          },
        }),
        expect.objectContaining({
          id: 'bpmn:gw1',
          kind: 'gateway',
          label: 'Approved?',
        }),
        expect.objectContaining({
          id: 'bpmn:f1',
          kind: 'sequence-flow',
          label: 'f1',
        }),
      ]),
    );

    expect(entities.some((entity) => entity.id === 'bpmn:Definitions_1')).toBe(false);
    expect(entities.some((entity) => entity.metadata.bpmnType.startsWith('bpmndi:'))).toBe(false);
    expect(entities.some((entity) => entity.metadata.bpmnType.startsWith('dc:'))).toBe(false);
    expect(entities.some((entity) => entity.metadata.bpmnType.startsWith('di:'))).toBe(false);
  });

  test('preserves nested subprocess parent context while keeping BPMN IDs authoritative', async () => {
    const entities = await bpmnSemanticEntities(EXPANDED_SUBPROCESS, 'artifact-expanded');
    const subprocess = entities.find((entity) => entity.metadata.bpmnType === 'bpmn:SubProcess');
    expect(subprocess).toBeDefined();

    const child = entities.find(
      (entity) => entity.metadata.parentId === subprocess.id.replace(/^bpmn:/, ''),
    );
    expect(child).toBeDefined();
    expect(child.id).toBe(`bpmn:${child.address.slice(1)}`);
  });

  test('fails closed for malformed XML and missing artifact identity', async () => {
    await expect(bpmnSemanticEntities('<bpmn:definitions>', 'artifact-bpmn')).rejects.toThrow(
      BpmnSemanticSourceError,
    );
    await expect(bpmnSemanticEntities(SIMPLE_APPROVAL, '')).rejects.toThrow(/requires artifactId/);
  });
});
