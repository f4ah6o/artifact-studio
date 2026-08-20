import {
  derivedArtifactStatus,
  executeArtifactTransform,
  regenerateDerivedArtifact,
} from '../core/artifact-transform.js';
import { createBuiltInArtifactTransformRegistry } from '../core/builtin-artifact-transforms.js';
import {
  currentArtifactForAdapter,
  findCurrentArtifactById,
  openArtifact,
  projectArtifact,
} from './artifact-runtime-registry.js';

export function createArtifactTransformController({
  registry = createBuiltInArtifactTransformRegistry(),
  currentForAdapter = currentArtifactForAdapter,
  findById = findCurrentArtifactById,
  open = openArtifact,
  project = projectArtifact,
} = {}) {
  async function currentState(adapterId) {
    const artifact = await currentForAdapter(adapterId);
    if (!artifact) return { artifact: null, transforms: [], status: null, sources: [] };

    const transforms = registry.applicableTo(artifact.adapterId);
    if (!artifact.lineage) return { artifact, transforms, status: null, sources: [] };

    const sources = [];
    for (const record of artifact.lineage.derivedFrom || []) {
      const source = await findById(record?.artifactId);
      if (!source)
        throw new Error(`current source artifact is missing: ${record?.artifactId || ''}`);
      sources.push(source);
    }
    const status = await derivedArtifactStatus(artifact, sources);
    return { artifact, transforms, status, sources };
  }

  async function transformCurrent(adapterId, transformId) {
    const source = await currentForAdapter(adapterId);
    if (!source) throw new Error('current artifact is not available');
    const derived = await executeArtifactTransform({
      registry,
      transformId,
      artifact: source,
      context: { project },
    });
    return (await open(derived)) || derived;
  }

  async function regenerateCurrent(adapterId) {
    const derived = await currentForAdapter(adapterId);
    if (!derived?.lineage) throw new Error('current artifact is not derived');
    if (!Array.isArray(derived.lineage.derivedFrom) || derived.lineage.derivedFrom.length !== 1) {
      throw new Error('regeneration currently requires exactly one source artifact');
    }
    const sourceId = derived.lineage.derivedFrom[0]?.artifactId;
    const source = await findById(sourceId);
    if (!source) throw new Error(`current source artifact is missing: ${sourceId || ''}`);

    const regenerated = await regenerateDerivedArtifact({
      registry,
      derivedArtifact: derived,
      artifact: source,
      context: { project },
    });
    return (await open(regenerated)) || regenerated;
  }

  return Object.freeze({
    registry,
    currentState,
    transformCurrent,
    regenerateCurrent,
  });
}
