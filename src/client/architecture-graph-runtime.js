import {
  buildArchitectureGraph,
  projectArtifactRelationships,
} from '../core/architecture-graph.js';
import { resolveSemanticRefForArtifact } from './artifact-runtime-registry.js';

function workspaceParts(workspace) {
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
    throw new TypeError('artifact workspace is required');
  }
  return {
    artifacts: workspace.artifacts || {},
    relationships: workspace.relationships || {},
  };
}

export async function architectureGraphForWorkspace(workspace) {
  const { artifacts, relationships } = workspaceParts(workspace);
  return buildArchitectureGraph(relationships, {
    artifacts,
    resolveEntity: resolveSemanticRefForArtifact,
  });
}

export async function architectureGraphProjectionForWorkspace(workspace) {
  const { artifacts, relationships } = workspaceParts(workspace);
  return projectArtifactRelationships(relationships, {
    artifacts,
    resolveEntity: resolveSemanticRefForArtifact,
  });
}
