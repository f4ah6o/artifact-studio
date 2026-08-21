const BPMN_FLOW_NODE_PATTERN =
  /<(?:bpmn:)?(?:startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent|task|userTask|serviceTask|scriptTask|sendTask|receiveTask|manualTask|businessRuleTask|callActivity|subProcess|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway|complexGateway)\b/i;

export function artifactIsShellEmpty(artifact) {
  const content = artifact?.content;
  if (!content) return true;
  if (content.kind === 'workspace') {
    return Object.values(content.files || {}).every((source) => !String(source || '').trim());
  }
  if (content.kind !== 'text') return false;
  const source = String(content.source || '');
  if (!source.trim()) return true;
  if (artifact.adapterId !== 'bpmn') return false;
  return !BPMN_FLOW_NODE_PATTERN.test(source);
}

export function artifactDisplayTitle(artifact, adapterLabel) {
  const fallback = String(adapterLabel || artifact?.adapterId || 'Artifact');
  const title = String(artifact?.title || '').trim();
  return title && title !== artifact?.adapterId ? title : fallback;
}

export function nextAvailableArtifactTitle(adapterId, adapterLabel, artifacts = []) {
  const base = String(adapterLabel || adapterId || 'Artifact');
  const used = new Set(
    artifacts
      .filter((artifact) => artifact?.adapterId === adapterId)
      .map((artifact) => String(artifact?.title || '').trim())
      .filter(Boolean),
  );
  let ordinal = 1;
  while (used.has(`${base} ${ordinal}`)) ordinal += 1;
  return `${base} ${ordinal}`;
}
