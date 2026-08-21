import { normalizeArtifactRelationships } from '../core/artifact-relationship.js';
import { normalizeSemanticEntities, resolveSemanticEntity } from '../core/semantic-entity.js';
import { readArtifactRecordById } from './artifact-content.js';

const runtimes = new Map();
const listeners = new Set();

function requiredAdapterId(value) {
  const adapterId = typeof value === 'string' ? value.trim() : '';
  if (!adapterId) throw new Error('artifact runtime adapterId is required');
  return adapterId;
}

function notify() {
  for (const listener of listeners) listener();
}

export function registerArtifactRuntime(adapterId, runtime) {
  const id = requiredAdapterId(adapterId);
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    throw new Error(`artifact runtime must be an object: ${id}`);
  }
  if (typeof runtime.currentArtifact !== 'function') {
    throw new Error(`artifact runtime currentArtifact() is required: ${id}`);
  }
  if (runtimes.has(id)) throw new Error(`duplicate artifact runtime: ${id}`);

  const registered = Object.freeze({ adapterId: id, ...runtime });
  runtimes.set(id, registered);
  notify();
  return registered;
}

export function getArtifactRuntime(adapterId) {
  return runtimes.get(String(adapterId || '')) || null;
}

export function listArtifactRuntimes() {
  return [...runtimes.values()].sort((a, b) => a.adapterId.localeCompare(b.adapterId, 'en'));
}

export async function currentArtifactForAdapter(adapterId) {
  const runtime = getArtifactRuntime(adapterId);
  if (!runtime) return null;
  return (await runtime.currentArtifact()) || null;
}

export async function findCurrentArtifactById(artifactId) {
  const id = String(artifactId || '');
  if (!id) return null;
  for (const runtime of listArtifactRuntimes()) {
    const artifact = await runtime.currentArtifact();
    if (artifact?.id === id) return artifact;
  }
  try {
    return readArtifactRecordById(id);
  } catch {
    return null;
  }
}

export async function semanticEntitiesForArtifact(artifact) {
  const runtime = getArtifactRuntime(artifact?.adapterId);
  if (!runtime || typeof runtime.semanticEntities !== 'function') {
    throw new Error(
      `artifact adapter does not provide semantic entity capability: ${artifact?.adapterId || ''}`,
    );
  }
  const entities = await runtime.semanticEntities(artifact);
  return normalizeSemanticEntities(entities, { artifactId: artifact?.id });
}

export async function discoveredRelationshipsForArtifact(artifact) {
  const runtime = getArtifactRuntime(artifact?.adapterId);
  if (!runtime || typeof runtime.discoverRelationships !== 'function') return [];
  const values = await runtime.discoverRelationships(artifact);
  const relationships = Object.values(normalizeArtifactRelationships(values));
  for (const relationship of relationships) {
    if (relationship.provenance !== 'discovered') {
      throw new Error(
        `artifact adapter returned non-discovered relationship: ${artifact?.adapterId || ''} / ${relationship.id}`,
      );
    }
  }
  return relationships;
}

export function createSemanticRefResolver() {
  const entityPromises = new Map();
  return async (ref, artifact) => {
    const runtime = getArtifactRuntime(artifact?.adapterId);
    if (!runtime || typeof runtime.semanticEntities !== 'function') return undefined;
    if (!entityPromises.has(artifact.id)) {
      entityPromises.set(artifact.id, semanticEntitiesForArtifact(artifact));
    }
    const entities = await entityPromises.get(artifact.id);
    return resolveSemanticEntity(entities, ref);
  };
}

export async function resolveSemanticRefForArtifact(ref, artifact) {
  const runtime = getArtifactRuntime(artifact?.adapterId);
  if (!runtime || typeof runtime.semanticEntities !== 'function') return undefined;
  const entities = await semanticEntitiesForArtifact(artifact);
  return resolveSemanticEntity(entities, ref);
}

export async function projectArtifact(artifact) {
  const runtime = getArtifactRuntime(artifact?.adapterId);
  if (!runtime || typeof runtime.project !== 'function') {
    throw new Error(
      `artifact adapter does not provide project capability: ${artifact?.adapterId || ''}`,
    );
  }
  return runtime.project(artifact);
}

export async function openArtifact(artifact) {
  const runtime = getArtifactRuntime(artifact?.adapterId);
  if (!runtime || typeof runtime.openArtifact !== 'function') {
    throw new Error(
      `artifact adapter cannot open transformed content: ${artifact?.adapterId || ''}`,
    );
  }
  const result = await runtime.openArtifact(artifact);
  notify();
  return result;
}

export function onArtifactRuntimeChange(listener) {
  if (typeof listener !== 'function')
    throw new Error('artifact runtime listener must be a function');
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyArtifactRuntimeChange() {
  notify();
}

export function clearArtifactRuntimesForTests() {
  runtimes.clear();
  listeners.clear();
}
