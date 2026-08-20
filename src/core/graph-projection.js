export class GraphProjectionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GraphProjectionError';
  }
}

function normalizeMetadata(value, name) {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new GraphProjectionError(`${name} must be an object`);
  }
  return { ...value };
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), 'en');
}

export function normalizeGraphProjection(value) {
  if (!value || typeof value !== 'object') {
    throw new GraphProjectionError('graph projection must be an object');
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new GraphProjectionError('graph projection requires nodes and edges arrays');
  }

  const ids = new Set();
  const nodes = value.nodes.map((node, index) => {
    if (!node || typeof node !== 'object') {
      throw new GraphProjectionError(`nodes[${index}] must be an object`);
    }
    const id = String(node.id || '');
    const label = String(node.label || '');
    if (!id) throw new GraphProjectionError(`nodes[${index}].id is required`);
    if (!label) throw new GraphProjectionError(`nodes[${index}].label is required`);
    if (ids.has(id)) throw new GraphProjectionError(`duplicate graph node id: ${id}`);
    ids.add(id);

    const normalized = { id, label };
    if (node.kind != null && String(node.kind)) normalized.kind = String(node.kind);
    const metadata = normalizeMetadata(node.metadata, `nodes[${index}].metadata`);
    if (metadata) normalized.metadata = metadata;
    return normalized;
  });

  const edges = value.edges.map((edge, index) => {
    if (!edge || typeof edge !== 'object') {
      throw new GraphProjectionError(`edges[${index}] must be an object`);
    }
    const from = String(edge.from || '');
    const to = String(edge.to || '');
    if (!from || !to) throw new GraphProjectionError(`edges[${index}] requires from and to`);
    if (!ids.has(from)) throw new GraphProjectionError(`dangling graph edge source: ${from}`);
    if (!ids.has(to)) throw new GraphProjectionError(`dangling graph edge target: ${to}`);

    const normalized = { from, to };
    if (edge.kind != null && String(edge.kind)) normalized.kind = String(edge.kind);
    const metadata = normalizeMetadata(edge.metadata, `edges[${index}].metadata`);
    if (metadata) normalized.metadata = metadata;
    return normalized;
  });

  nodes.sort((a, b) => compareText(a.id, b.id));
  edges.sort(
    (a, b) =>
      compareText(a.from, b.from) ||
      compareText(a.to, b.to) ||
      compareText(a.kind || '', b.kind || ''),
  );

  return { kind: 'graph', nodes, edges };
}
