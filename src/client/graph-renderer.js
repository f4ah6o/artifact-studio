import { graphProjectionToMermaid } from '../core/graph-projection-mermaid.js';
import { loadArtifactAdapter } from './artifact-adapters.js';

export { graphProjectionToMermaid };

export async function renderGraphProjection(projection, target) {
  const mermaid = await loadArtifactAdapter('mermaid');
  await mermaid.render(graphProjectionToMermaid(projection), target);
}
