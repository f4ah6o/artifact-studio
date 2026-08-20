import { normalizeArtifactContent, textContent } from '../core/artifact-content.js';
import {
  artifactRelationship,
  normalizeArtifactRelationships,
} from '../core/artifact-relationship.js';

export const ARTIFACT_WORKSPACE_STORAGE_KEY = 'artifact-studio:workspace:v2';
export const LEGACY_SHELL_WORKSPACE_STORAGE_KEY = 'artifact-studio:workspace:v1';
export const LEGACY_ARTIFACT_CONTENT_STORAGE_KEY = 'artifact-studio:artifact-content:v1';
export const LEGACY_LAST_ARTIFACT_STORAGE_KEY = 'artifact-studio:last-artifact:v1';
export const LEGACY_BPMN_STORAGE_KEY = 'ai-bpmn-modeler:last-diagram:v1';

function parseJson(raw) {
  try {
    return JSON.parse(raw || 'null');
  } catch {
    return null;
  }
}

function defaultLegacyId(adapterId) {
  return `artifact:${adapterId}`;
}

function normalizeLineage(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

export function normalizeArtifactNode(value, fallbackId = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const adapterId = typeof value.adapterId === 'string' ? value.adapterId.trim() : '';
  const id = typeof value.id === 'string' && value.id.trim() ? value.id : fallbackId;
  if (!adapterId || !id) return null;

  let content;
  try {
    content = normalizeArtifactContent(value.content);
  } catch {
    return null;
  }

  const node = { id, adapterId, content };
  if (typeof value.revision === 'string' && value.revision.trim()) node.revision = value.revision;
  const lineage = normalizeLineage(value.lineage);
  if (lineage) node.lineage = lineage;
  if (typeof value.updatedAt === 'string' && value.updatedAt) node.updatedAt = value.updatedAt;
  return node;
}

export function emptyArtifactWorkspace() {
  return { version: 2, activeArtifactId: null, artifacts: {}, relationships: {}, aiSessions: {} };
}

export function normalizeArtifactWorkspace(value) {
  if (!value || value.version !== 2 || !value.artifacts || typeof value.artifacts !== 'object') {
    return null;
  }
  const workspace = emptyArtifactWorkspace();
  for (const [key, valueNode] of Object.entries(value.artifacts)) {
    const node = normalizeArtifactNode(valueNode, key);
    if (node) workspace.artifacts[node.id] = node;
  }
  if (
    typeof value.activeArtifactId === 'string' &&
    Object.hasOwn(workspace.artifacts, value.activeArtifactId)
  ) {
    workspace.activeArtifactId = value.activeArtifactId;
  }
  try {
    workspace.relationships = normalizeArtifactRelationships(value.relationships || {});
  } catch {
    workspace.relationships = {};
  }
  if (
    value.aiSessions &&
    typeof value.aiSessions === 'object' &&
    !Array.isArray(value.aiSessions)
  ) {
    workspace.aiSessions = value.aiSessions;
  }
  return workspace;
}

function legacyContentRecord(adapterId, entry) {
  if (!entry || typeof entry !== 'object') return null;
  let content = null;
  try {
    if (entry.content) content = normalizeArtifactContent(entry.content);
    else if (typeof entry.source === 'string') content = textContent(entry.source);
  } catch {
    return null;
  }
  if (!content) return null;
  return normalizeArtifactNode(
    {
      id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : defaultLegacyId(adapterId),
      adapterId,
      content,
      revision: entry.revision,
      lineage: entry.lineage,
      updatedAt: entry.updatedAt,
    },
    defaultLegacyId(adapterId),
  );
}

function addIfMissingAdapter(workspace, node) {
  if (!node) return null;
  const existing = Object.values(workspace.artifacts).find(
    (artifact) => artifact.adapterId === node.adapterId,
  );
  if (existing) return existing;
  workspace.artifacts[node.id] = node;
  return node;
}

export function migrateArtifactWorkspace(storage) {
  const workspace = emptyArtifactWorkspace();
  const generic = parseJson(storage.getItem(LEGACY_ARTIFACT_CONTENT_STORAGE_KEY));
  if (generic?.version === 1 && generic.artifacts && typeof generic.artifacts === 'object') {
    for (const [adapterId, entry] of Object.entries(generic.artifacts)) {
      const node = legacyContentRecord(adapterId, entry);
      if (node) workspace.artifacts[node.id] = node;
    }
  }

  const shell = parseJson(storage.getItem(LEGACY_SHELL_WORKSPACE_STORAGE_KEY));
  if (shell?.version === 1 && shell.artifacts && typeof shell.artifacts === 'object') {
    if (
      shell.aiSessions &&
      typeof shell.aiSessions === 'object' &&
      !Array.isArray(shell.aiSessions)
    ) {
      workspace.aiSessions = shell.aiSessions;
    }
    for (const [adapterId, entry] of Object.entries(shell.artifacts)) {
      addIfMissingAdapter(workspace, legacyContentRecord(adapterId, entry));
    }
    if (typeof shell.activeAdapter === 'string') {
      workspace.activeArtifactId =
        Object.values(workspace.artifacts).find(
          (artifact) => artifact.adapterId === shell.activeAdapter,
        )?.id || null;
    }
  }

  const previous = parseJson(storage.getItem(LEGACY_LAST_ARTIFACT_STORAGE_KEY));
  if (typeof previous?.adapter === 'string' && typeof previous?.source === 'string') {
    const node = addIfMissingAdapter(
      workspace,
      legacyContentRecord(previous.adapter, {
        source: previous.source,
        updatedAt: previous.updatedAt,
      }),
    );
    workspace.activeArtifactId ||= node?.id || null;
  }

  if (!Object.values(workspace.artifacts).some((artifact) => artifact.adapterId === 'bpmn')) {
    const legacy = parseJson(storage.getItem(LEGACY_BPMN_STORAGE_KEY));
    if (legacy?.version === 1 && typeof legacy.xml === 'string' && legacy.xml.trim()) {
      const node = legacyContentRecord('bpmn', { source: legacy.xml, updatedAt: legacy.savedAt });
      if (node) workspace.artifacts[node.id] = node;
      workspace.activeArtifactId ||= node?.id || null;
    }
  }

  workspace.activeArtifactId ||= Object.keys(workspace.artifacts)[0] || null;
  return workspace;
}

export function readArtifactWorkspace(storage = localStorage) {
  const current = normalizeArtifactWorkspace(
    parseJson(storage.getItem(ARTIFACT_WORKSPACE_STORAGE_KEY)),
  );
  return current || migrateArtifactWorkspace(storage);
}

export function writeArtifactWorkspace(workspace, storage = localStorage) {
  const normalized = normalizeArtifactWorkspace(workspace);
  if (!normalized) throw new Error('invalid artifact workspace v2');
  storage.setItem(ARTIFACT_WORKSPACE_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function createArtifactId(
  adapterId,
  randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
) {
  const safeAdapterId = String(adapterId || '').trim();
  if (!safeAdapterId) throw new Error('adapterId is required');
  const suffix = randomUUID ? randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `artifact:${safeAdapterId}:${suffix}`;
}

export class ArtifactWorkspaceStore {
  constructor(storage = localStorage) {
    this.storage = storage;
    this.workspace = readArtifactWorkspace(storage);
    this.listeners = new Set();
    this.persist();
  }

  persist() {
    this.workspace = writeArtifactWorkspace(this.workspace, this.storage);
    return this.workspace;
  }

  notify() {
    for (const listener of this.listeners) listener(this.workspace);
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(adapterId = null) {
    const artifacts = Object.values(this.workspace.artifacts);
    return adapterId ? artifacts.filter((artifact) => artifact.adapterId === adapterId) : artifacts;
  }

  get(artifactId) {
    return this.workspace.artifacts[String(artifactId || '')] || null;
  }

  active() {
    return this.get(this.workspace.activeArtifactId);
  }

  activeForAdapter(adapterId) {
    const active = this.active();
    if (active?.adapterId === adapterId) return active;
    return this.list(adapterId)[0] || null;
  }

  select(artifactId) {
    const artifact = this.get(artifactId);
    if (!artifact) throw new Error(`unknown artifact: ${artifactId}`);
    this.workspace.activeArtifactId = artifact.id;
    this.persist();
    this.notify();
    return artifact;
  }

  create(adapterId, content, { id = null, activate = true } = {}) {
    const node = normalizeArtifactNode({
      id: id || createArtifactId(adapterId),
      adapterId,
      content,
      updatedAt: new Date().toISOString(),
    });
    if (!node) throw new Error('invalid artifact');
    if (this.workspace.artifacts[node.id]) throw new Error(`duplicate artifact id: ${node.id}`);
    this.workspace.artifacts[node.id] = node;
    if (activate) this.workspace.activeArtifactId = node.id;
    this.persist();
    this.notify();
    return node;
  }

  upsert(artifact, { activate = false } = {}) {
    const node = normalizeArtifactNode({ ...artifact, updatedAt: new Date().toISOString() });
    if (!node) throw new Error('invalid artifact');
    this.workspace.artifacts[node.id] = node;
    if (activate) this.workspace.activeArtifactId = node.id;
    this.persist();
    this.notify();
    return node;
  }

  updateContent(adapterId, content) {
    const current = this.activeForAdapter(adapterId);
    if (!current) return this.create(adapterId, content, { activate: true });
    return this.upsert({ ...current, content }, { activate: this.active()?.id === current.id });
  }

  listRelationships() {
    return Object.values(this.workspace.relationships || {});
  }

  getRelationship(relationshipId) {
    return this.workspace.relationships?.[String(relationshipId || '')] || null;
  }

  upsertRelationship(value) {
    const relationship = artifactRelationship(value);
    this.workspace.relationships ||= {};
    this.workspace.relationships[relationship.id] = relationship;
    this.persist();
    this.notify();
    return relationship;
  }

  removeRelationship(relationshipId) {
    const id = String(relationshipId || '');
    const existing = this.workspace.relationships?.[id] || null;
    if (!existing) return null;
    delete this.workspace.relationships[id];
    this.persist();
    this.notify();
    return existing;
  }

  replaceWorkspace(workspace) {
    const normalized = normalizeArtifactWorkspace(workspace);
    if (!normalized) throw new Error('invalid artifact workspace v2');
    this.workspace = normalized;
    this.persist();
    this.notify();
    return this.workspace;
  }
}

const stores = new WeakMap();

export function artifactWorkspaceStore(storage = localStorage) {
  if (!stores.has(storage)) stores.set(storage, new ArtifactWorkspaceStore(storage));
  return stores.get(storage);
}
