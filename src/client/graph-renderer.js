import { graphProjectionToMermaid } from '../core/graph-projection-mermaid.js';
import { loadArtifactAdapter } from './artifact-adapters.js';

export { graphProjectionToMermaid };

export function bindGraphProjectionNodes(projection, target, onNodeClick) {
  if (typeof onNodeClick !== 'function') return;
  for (const [index, node] of (projection?.nodes || []).entries()) {
    const element = target.querySelector(`[id*="-flowchart-n${index}-"]`);
    if (!element) continue;
    element.dataset.graphNodeId = node.id;
    element.classList.add('graph-projection-node-interactive');
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    const activate = () => onNodeClick(node);
    element.addEventListener('click', activate);
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activate();
    });
  }
}

export async function renderGraphProjection(projection, target, { onNodeClick = null } = {}) {
  const mermaid = await loadArtifactAdapter('mermaid');
  await mermaid.render(graphProjectionToMermaid(projection), target);
  bindGraphProjectionNodes(projection, target, onNodeClick);
}
