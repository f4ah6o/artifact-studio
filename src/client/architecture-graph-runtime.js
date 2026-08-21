import { normalizeArtifactRelationships } from '../core/artifact-relationship.js';
import {
  buildArchitectureGraph,
  projectArtifactRelationships,
} from '../core/architecture-graph.js';
import {
  createSemanticRefResolver,
  discoveredRelationshipsForArtifact,
} from './artifact-runtime-registry.js';

function workspaceParts(workspace) {
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
    throw new TypeError('artifact workspace is required');
  }
  return {
    artifacts: workspace.artifacts || {},
    relationships: workspace.relationships || {},
  };
}

export async function architectureRelationshipsForWorkspace(workspace) {
  const { artifacts, relationships } = workspaceParts(workspace);
  const values = Object.values(relationships);
  for (const artifact of Object.values(artifacts)) {
    values.push(...(await discoveredRelationshipsForArtifact(artifact)));
  }
  return normalizeArtifactRelationships(values);
}

export async function architectureGraphForWorkspace(workspace) {
  const { artifacts } = workspaceParts(workspace);
  const relationships = await architectureRelationshipsForWorkspace(workspace);
  return buildArchitectureGraph(relationships, {
    artifacts,
    resolveEntity: createSemanticRefResolver(),
  });
}

export async function architectureGraphProjectionForWorkspace(workspace) {
  const { artifacts } = workspaceParts(workspace);
  const relationships = await architectureRelationshipsForWorkspace(workspace);
  return projectArtifactRelationships(relationships, {
    artifacts,
    resolveEntity: createSemanticRefResolver(),
  });
}
