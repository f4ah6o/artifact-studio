import {
  ARTIFACT_CONTENT_KINDS,
  ArtifactContentError,
  contentMatchesKind,
  normalizeArtifactContent,
  textContent,
  workspaceContent,
} from '../core/artifact-content.js';
import {
  ARTIFACT_WORKSPACE_STORAGE_KEY,
  LEGACY_ARTIFACT_CONTENT_STORAGE_KEY,
  LEGACY_SHELL_WORKSPACE_STORAGE_KEY,
  artifactWorkspaceStore,
  createArtifactId,
} from './artifact-workspace.js';

const ARTIFACT_CONTENT_STORAGE_KEY = LEGACY_ARTIFACT_CONTENT_STORAGE_KEY;
const LEGACY_WORKSPACE_STORAGE_KEY = LEGACY_SHELL_WORKSPACE_STORAGE_KEY;

function storeFor(storage) {
  return artifactWorkspaceStore(storage);
}

export function readArtifactRecord(adapterId, storage = localStorage) {
  return storeFor(storage).activeForAdapter(String(adapterId || ''));
}

export function readArtifactRecordById(artifactId, storage = localStorage) {
  return storeFor(storage).get(artifactId);
}

export function listArtifactRecords(storage = localStorage, adapterId = null) {
  return storeFor(storage).list(adapterId);
}

export function activeArtifactRecord(storage = localStorage) {
  return storeFor(storage).active();
}

export function readArtifactContent(adapterId, storage = localStorage) {
  return readArtifactRecord(adapterId, storage)?.content || null;
}

export function persistArtifactRecord(artifact, storage = localStorage, { activate = true } = {}) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new ArtifactContentError('artifact record is required');
  }
  const adapterId = typeof artifact.adapterId === 'string' ? artifact.adapterId.trim() : '';
  if (!adapterId) throw new ArtifactContentError('adapter id is required');
  const id =
    typeof artifact.id === 'string' && artifact.id.trim()
      ? artifact.id
      : createArtifactId(adapterId);
  return storeFor(storage).upsert(
    {
      ...artifact,
      id,
      adapterId,
      content: normalizeArtifactContent(artifact.content),
    },
    { activate },
  );
}

export function persistArtifactContent(adapterId, content, storage = localStorage) {
  if (!adapterId) throw new ArtifactContentError('adapter id is required');
  return storeFor(storage).updateContent(adapterId, normalizeArtifactContent(content));
}

export function currentArtifactRecord(adapterId, content, storage = localStorage) {
  const store = storeFor(storage);
  const existing = store.activeForAdapter(adapterId);
  if (existing) {
    return { ...existing, content: normalizeArtifactContent(content) };
  }
  return store.create(adapterId, normalizeArtifactContent(content), { activate: !store.active() });
}

export function createArtifactRecord(adapterId, content, storage = localStorage, options = {}) {
  return storeFor(storage).create(adapterId, normalizeArtifactContent(content), options);
}

export function renameArtifactRecord(artifactId, title, storage = localStorage) {
  return storeFor(storage).rename(artifactId, title);
}

export function removeArtifactRecord(artifactId, storage = localStorage) {
  return storeFor(storage).remove(artifactId);
}

export function reusableEmptyArtifact(adapterId, options = {}, storage = localStorage) {
  return storeFor(storage).firstReusableEmpty(adapterId, options);
}

export function cleanupEmptyArtifactRecords(options = {}, storage = localStorage) {
  return storeFor(storage).cleanupEmptyArtifacts(options);
}

export function selectArtifactRecord(artifactId, storage = localStorage) {
  return storeFor(storage).select(artifactId);
}

export function artifactWorkspaceSnapshot(storage = localStorage) {
  return storeFor(storage).workspace;
}

export function persistArtifactWorkspace(storage = localStorage) {
  return storeFor(storage).persist();
}

export function replaceArtifactWorkspace(workspace, storage = localStorage) {
  return storeFor(storage).replaceWorkspace(workspace);
}

export function onArtifactWorkspaceChange(listener, storage = localStorage) {
  return storeFor(storage).onChange(listener);
}

export {
  ARTIFACT_CONTENT_KINDS,
  ARTIFACT_CONTENT_STORAGE_KEY,
  ARTIFACT_WORKSPACE_STORAGE_KEY,
  ArtifactContentError,
  contentMatchesKind,
  LEGACY_WORKSPACE_STORAGE_KEY,
  normalizeArtifactContent,
  textContent,
  workspaceContent,
};
