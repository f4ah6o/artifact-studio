import { normalizeArtifactRelationships, semanticRef } from './artifact-relationship.js';
import { normalizeGraphProjection } from './graph-projection.js';
import { semanticEntity } from './semantic-entity.js';

export class ArchitectureGraphError extends Error {
  constructor(message, code = 'ARCHITECTURE_GRAPH_INVALID', details = {}) {
    super(message);
    this.name = 'ArchitectureGraphError';
    this.code = code;
    Object.assign(this, details);
  }
}

function artifactMapOf(artifacts) {
  return artifacts instanceof Map ? artifacts : new Map(Object.entries(artifacts || {}));
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), 'en');
}

function hasEntitySelector(ref) {
  return Boolean(ref.entityId || ref.address);
}

function encoded(value) {
  return encodeURIComponent(String(value));
}

function canonicalRef(ref, entity = null) {
  if (!entity) return ref;
  const value = { artifactId: entity.artifactId, entityId: entity.id };
  if (entity.address) value.address = entity.address;
  return semanticRef(value);
}

function nodeIdFor(ref, entity = null) {
  if (entity) {
    return `architecture:entity:${encoded(entity.artifactId)}:${encoded(entity.id)}`;
  }
  if (!hasEntitySelector(ref)) {
    return `architecture:artifact:${encoded(ref.artifactId)}`;
  }
  const selector = ref.entityId ? `id:${ref.entityId}` : `address:${ref.address}`;
  return `architecture:ref:${encoded(ref.artifactId)}:${encoded(selector)}`;
}

function finding(relationshipId, endpoint, code, ref) {
  return Object.freeze({ relationshipId, endpoint, code, ref });
}

async function resolveEndpoint(relationship, endpoint, artifactMap, resolveEntity, findings) {
  const ref = relationship[endpoint];
  const artifact = artifactMap.get(ref.artifactId) || null;
  if (!artifact) {
    findings.push(finding(relationship.id, endpoint, 'missing_artifact', ref));
    return {
      id: nodeIdFor(ref),
      ref,
      label: ref.address || ref.entityId || ref.artifactId,
      kind: 'missing-artifact',
      status: 'missing-artifact',
      artifactId: ref.artifactId,
      adapterId: null,
      entity: null,
    };
  }

  if (!hasEntitySelector(ref)) {
    return {
      id: nodeIdFor(ref),
      ref,
      label: artifact.title || artifact.id,
      kind: 'artifact',
      status: 'resolved',
      artifactId: artifact.id,
      adapterId: artifact.adapterId || null,
      entity: null,
    };
  }

  if (typeof resolveEntity !== 'function') {
    findings.push(finding(relationship.id, endpoint, 'entity_unresolved', ref));
    return {
      id: nodeIdFor(ref),
      ref,
      label: ref.address || ref.entityId,
      kind: 'semantic-ref',
      status: 'unresolved',
      artifactId: artifact.id,
      adapterId: artifact.adapterId || null,
      entity: null,
    };
  }

  const resolved = await resolveEntity(ref, artifact);
  if (resolved === undefined) {
    findings.push(finding(relationship.id, endpoint, 'entity_unresolved', ref));
    return {
      id: nodeIdFor(ref),
      ref,
      label: ref.address || ref.entityId,
      kind: 'semantic-ref',
      status: 'unresolved',
      artifactId: artifact.id,
      adapterId: artifact.adapterId || null,
      entity: null,
    };
  }
  if (resolved === null || resolved === false) {
    findings.push(finding(relationship.id, endpoint, 'missing_entity', ref));
    return {
      id: nodeIdFor(ref),
      ref,
      label: ref.address || ref.entityId,
      kind: 'semantic-ref',
      status: 'missing-entity',
      artifactId: artifact.id,
      adapterId: artifact.adapterId || null,
      entity: null,
    };
  }

  const entity = semanticEntity(resolved);
  if (entity.artifactId !== artifact.id) {
    throw new ArchitectureGraphError(
      `resolved SemanticEntity ${entity.id} belongs to unexpected artifact ${entity.artifactId}`,
      'ARCHITECTURE_GRAPH_ENTITY_ARTIFACT_MISMATCH',
      { relationshipId: relationship.id, endpoint, ref, entity },
    );
  }
  const resolvedRef = canonicalRef(ref, entity);
  return {
    id: nodeIdFor(resolvedRef, entity),
    ref: resolvedRef,
    label: entity.label || entity.address || entity.id,
    kind: entity.kind,
    status: 'resolved',
    artifactId: artifact.id,
    adapterId: artifact.adapterId || null,
    entity,
  };
}

function mergeNode(nodes, node) {
  const existing = nodes.get(node.id);
  if (!existing) {
    nodes.set(node.id, node);
    return node;
  }
  if (
    existing.artifactId !== node.artifactId ||
    existing.ref.entityId !== node.ref.entityId ||
    existing.ref.address !== node.ref.address
  ) {
    throw new ArchitectureGraphError(
      `architecture graph node identity conflict: ${node.id}`,
      'ARCHITECTURE_GRAPH_NODE_CONFLICT',
      { existing, node },
    );
  }
  return existing;
}

export async function buildArchitectureGraph(
  values,
  { artifacts = {}, resolveEntity = null } = {},
) {
  const relationships = normalizeArtifactRelationships(values);
  const artifactMap = artifactMapOf(artifacts);
  const findings = [];
  const nodes = new Map();
  const edges = [];

  for (const relationship of Object.values(relationships)) {
    const from = mergeNode(
      nodes,
      await resolveEndpoint(relationship, 'from', artifactMap, resolveEntity, findings),
    );
    const to = mergeNode(
      nodes,
      await resolveEndpoint(relationship, 'to', artifactMap, resolveEntity, findings),
    );
    edges.push({
      id: relationship.id,
      type: relationship.type,
      from: from.id,
      to: to.id,
      provenance: relationship.provenance,
      relationship,
    });
  }

  const normalizedNodes = [...nodes.values()].sort((a, b) => compareText(a.id, b.id));
  edges.sort((a, b) => compareText(a.id, b.id));
  findings.sort(
    (a, b) =>
      compareText(a.relationshipId, b.relationshipId) || compareText(a.endpoint, b.endpoint),
  );

  return Object.freeze({
    nodes: Object.freeze(normalizedNodes),
    edges: Object.freeze(edges),
    findings: Object.freeze(findings),
  });
}

export function architectureGraphProjection(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new ArchitectureGraphError('architecture graph requires nodes and edges arrays');
  }
  return normalizeGraphProjection({
    nodes: graph.nodes.map((node) => {
      const metadata = {
        artifactId: node.artifactId,
        status: node.status,
      };
      if (node.adapterId) metadata.adapterId = node.adapterId;
      if (node.ref.entityId) metadata.entityId = node.ref.entityId;
      if (node.ref.address) metadata.address = node.ref.address;
      return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        metadata,
      };
    }),
    edges: graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      kind: edge.type,
      metadata: {
        relationshipId: edge.id,
        provenance: edge.provenance,
      },
    })),
  });
}

export async function projectArtifactRelationships(values, options = {}) {
  const architecture = await buildArchitectureGraph(values, options);
  return Object.freeze({
    graph: architectureGraphProjection(architecture),
    findings: architecture.findings,
  });
}

function nodeMatchesRef(node, valueRef) {
  const ref = semanticRef(valueRef);
  if (node.artifactId !== ref.artifactId) return false;
  if (!ref.entityId && !ref.address) return !node.ref.entityId && !node.ref.address;
  if (ref.entityId && node.ref.entityId !== ref.entityId) return false;
  if (ref.address && node.ref.address !== ref.address) return false;
  return true;
}

function startNode(graph, start) {
  if (typeof start === 'string') {
    return graph.nodes.find((node) => node.id === start) || null;
  }
  return graph.nodes.find((node) => nodeMatchesRef(node, start)) || null;
}

function traversalLimit(value) {
  if (value === Infinity) return Infinity;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new ArchitectureGraphError('maxDepth must be a non-negative integer or Infinity');
  }
  return number;
}

export function traverseArchitectureGraph(
  graph,
  start,
  { direction = 'outgoing', maxDepth = Infinity } = {},
) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new ArchitectureGraphError('architecture graph requires nodes and edges arrays');
  }
  if (!['outgoing', 'incoming', 'both'].includes(direction)) {
    throw new ArchitectureGraphError(`unsupported traversal direction: ${direction}`);
  }
  const limit = traversalLimit(maxDepth);
  const root = startNode(graph, start);
  if (!root || limit === 0) return [];

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const visited = new Set([root.id]);
  const queue = [{ node: root, depth: 0, steps: [] }];
  const results = [];

  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= limit) continue;

    const candidates = [];
    for (const edge of graph.edges) {
      if ((direction === 'outgoing' || direction === 'both') && edge.from === current.node.id) {
        candidates.push({ edge, nextId: edge.to, traversalDirection: 'outgoing' });
      }
      if ((direction === 'incoming' || direction === 'both') && edge.to === current.node.id) {
        candidates.push({ edge, nextId: edge.from, traversalDirection: 'incoming' });
      }
    }
    candidates.sort(
      (a, b) =>
        compareText(a.edge.id, b.edge.id) ||
        compareText(a.traversalDirection, b.traversalDirection),
    );

    for (const candidate of candidates) {
      if (visited.has(candidate.nextId)) continue;
      const next = nodesById.get(candidate.nextId);
      if (!next) {
        throw new ArchitectureGraphError(
          `architecture graph edge ${candidate.edge.id} references missing node ${candidate.nextId}`,
        );
      }
      visited.add(next.id);
      const step = Object.freeze({
        relationshipId: candidate.edge.id,
        type: candidate.edge.type,
        provenance: candidate.edge.provenance,
        traversalDirection: candidate.traversalDirection,
        from: nodesById.get(candidate.edge.from).ref,
        to: nodesById.get(candidate.edge.to).ref,
      });
      const steps = Object.freeze([...current.steps, step]);
      const result = Object.freeze({
        nodeId: next.id,
        ref: next.ref,
        depth: current.depth + 1,
        steps,
      });
      results.push(result);
      queue.push({ node: next, depth: result.depth, steps });
    }
  }

  return Object.freeze(results);
}
