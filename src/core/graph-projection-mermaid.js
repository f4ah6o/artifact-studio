import { normalizeGraphProjection } from './graph-projection.js';

export function graphProjectionToMermaid(projection) {
  const graph = normalizeGraphProjection(projection);
  const ids = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
  const escapeLabel = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const lines = ['flowchart LR'];

  for (const node of graph.nodes) {
    lines.push(`  ${ids.get(node.id)}["${escapeLabel(node.label)}"]`);
  }
  for (const edge of graph.edges) {
    lines.push(`  ${ids.get(edge.from)} --> ${ids.get(edge.to)}`);
  }

  return `${lines.join('\n')}\n`;
}
