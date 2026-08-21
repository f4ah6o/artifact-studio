import { textContent } from './artifact-content.js';
import {
  ArtifactTransformError,
  ArtifactTransformRegistry,
  defineArtifactTransform,
} from './artifact-transform.js';
import { graphProjectionToMermaid } from './graph-projection-mermaid.js';

export const graphProjectionToMermaidTransform = defineArtifactTransform({
  id: 'graph-projection-to-mermaid',
  label: 'Graph Projection to Mermaid',
  from: ['opa', 'dagu', 'bonita-bdm'],
  to: 'mermaid',
  version: '1',
  async transform(artifact, context) {
    if (typeof context?.project !== 'function') {
      throw new ArtifactTransformError(
        'graph-projection-to-mermaid requires context.project(sourceArtifact)',
      );
    }
    const projection = await context.project(artifact);
    return textContent(graphProjectionToMermaid(projection));
  },
});

export const builtInArtifactTransforms = Object.freeze([graphProjectionToMermaidTransform]);

export function createBuiltInArtifactTransformRegistry() {
  return new ArtifactTransformRegistry(builtInArtifactTransforms);
}
