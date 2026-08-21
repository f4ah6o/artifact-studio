import { moddleParse } from '../bpmn/moddle-import.js';
import { normalizeSemanticEntities } from '../core/semantic-entity.js';

const MAX_SOURCE_BYTES = 6 * 1024 * 1024;

export class BpmnSemanticSourceError extends Error {
  constructor(message, code = 'BPMN_SEMANTIC_SOURCE_INVALID', details = {}) {
    super(message);
    this.name = 'BpmnSemanticSourceError';
    this.code = code;
    Object.assign(this, details);
  }
}

function sourceText(source) {
  const text = String(source ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_SOURCE_BYTES) {
    throw new BpmnSemanticSourceError(
      `BPMN source exceeds ${MAX_SOURCE_BYTES} bytes`,
      'BPMN_SEMANTIC_SOURCE_TOO_LARGE',
    );
  }
  if (!text.trim()) {
    throw new BpmnSemanticSourceError('BPMN source is empty', 'BPMN_SEMANTIC_SOURCE_EMPTY');
  }
  return text;
}

function normalizedArtifactId(value) {
  const artifactId = typeof value === 'string' ? value.trim() : '';
  if (!artifactId) {
    throw new BpmnSemanticSourceError(
      'BPMN SemanticEntity provider requires artifactId',
      'BPMN_SEMANTIC_ARTIFACT_ID_REQUIRED',
    );
  }
  return artifactId;
}

function semanticKind(type) {
  const name = String(type || '').replace(/^bpmn:/, '');
  if (name === 'Process') return 'process';
  if (name === 'Collaboration') return 'collaboration';
  if (name === 'Participant') return 'participant';
  if (name === 'Lane') return 'lane';
  if (name === 'SequenceFlow') return 'sequence-flow';
  if (name === 'MessageFlow') return 'message-flow';
  if (name === 'Association') return 'association';
  if (name === 'DataObject' || name === 'DataObjectReference') return 'data-object';
  if (name === 'DataStore' || name === 'DataStoreReference') return 'data-store';
  if (name === 'TextAnnotation') return 'annotation';
  if (name === 'Group') return 'group';
  if (name === 'Message') return 'message';
  if (name === 'Signal') return 'signal';
  if (name === 'Error') return 'error';
  if (name === 'Escalation') return 'escalation';
  if (name.endsWith('Gateway')) return 'gateway';
  if (name.endsWith('Event')) return 'event';
  if (
    name.endsWith('Task') ||
    name === 'CallActivity' ||
    name === 'SubProcess' ||
    name === 'Transaction'
  ) {
    return 'activity';
  }
  return 'bpmn-element';
}

function elementEntity(element, artifactId, parentId = null) {
  const id = typeof element?.id === 'string' ? element.id.trim() : '';
  if (!id) return null;
  const metadata = { bpmnType: String(element.$type || 'bpmn:BaseElement') };
  if (parentId) metadata.parentId = parentId;
  if (element.attachedToRef?.id) metadata.attachedToId = element.attachedToRef.id;
  if (typeof element.calledElement === 'string' && element.calledElement) {
    metadata.calledElement = element.calledElement;
  }
  return {
    id: `bpmn:${id}`,
    artifactId,
    kind: semanticKind(element.$type),
    label: String(element.name || id),
    address: `#${id}`,
    metadata,
  };
}

function collectLane(lane, artifactId, parentId, entities) {
  const entity = elementEntity(lane, artifactId, parentId);
  if (entity) entities.push(entity);
  const nextParentId = lane?.id || parentId;
  if (lane?.childLaneSet) {
    for (const child of lane.childLaneSet.lanes || []) {
      collectLane(child, artifactId, nextParentId, entities);
    }
  }
}

function collectFlowElements(elements, artifactId, parentId, entities) {
  for (const element of elements || []) {
    const entity = elementEntity(element, artifactId, parentId);
    if (entity) entities.push(entity);
    if (Array.isArray(element.flowElements) && element.flowElements.length) {
      collectFlowElements(element.flowElements, artifactId, element.id || parentId, entities);
    }
    for (const artifact of element.artifacts || []) {
      const artifactEntity = elementEntity(artifact, artifactId, element.id || parentId);
      if (artifactEntity) entities.push(artifactEntity);
    }
  }
}

function collectProcess(process, artifactId, entities) {
  const processEntity = elementEntity(process, artifactId);
  if (processEntity) entities.push(processEntity);
  const processId = process?.id || null;
  for (const laneSet of process.laneSets || []) {
    for (const lane of laneSet.lanes || []) collectLane(lane, artifactId, processId, entities);
  }
  collectFlowElements(process.flowElements, artifactId, processId, entities);
  for (const artifact of process.artifacts || []) {
    const entity = elementEntity(artifact, artifactId, processId);
    if (entity) entities.push(entity);
  }
}

function collectCollaboration(collaboration, artifactId, entities) {
  const collaborationEntity = elementEntity(collaboration, artifactId);
  if (collaborationEntity) entities.push(collaborationEntity);
  const parentId = collaboration?.id || null;
  for (const participant of collaboration.participants || []) {
    const entity = elementEntity(participant, artifactId, parentId);
    if (entity) entities.push(entity);
  }
  for (const messageFlow of collaboration.messageFlows || []) {
    const entity = elementEntity(messageFlow, artifactId, parentId);
    if (entity) entities.push(entity);
  }
  for (const artifact of collaboration.artifacts || []) {
    const entity = elementEntity(artifact, artifactId, parentId);
    if (entity) entities.push(entity);
  }
}

export async function bpmnSemanticEntities(source, artifactId) {
  const text = sourceText(source);
  const id = normalizedArtifactId(artifactId);
  let rootElement;
  try {
    ({ rootElement } = await moddleParse(text));
  } catch (error) {
    throw new BpmnSemanticSourceError(
      `Invalid BPMN XML: ${error?.message || String(error)}`,
      'BPMN_SEMANTIC_XML_INVALID',
    );
  }

  if (!rootElement || rootElement.$type !== 'bpmn:Definitions') {
    throw new BpmnSemanticSourceError(
      'BPMN root element must be bpmn:Definitions',
      'BPMN_SEMANTIC_ROOT_INVALID',
    );
  }

  const entities = [];
  for (const element of rootElement.rootElements || []) {
    if (element.$type === 'bpmn:Process') {
      collectProcess(element, id, entities);
    } else if (element.$type === 'bpmn:Collaboration') {
      collectCollaboration(element, id, entities);
    } else {
      const entity = elementEntity(element, id);
      if (entity) entities.push(entity);
    }
  }
  return normalizeSemanticEntities(entities, { artifactId: id });
}
