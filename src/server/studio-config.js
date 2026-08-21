const SUPPORTED_ADAPTERS = ['bpmn', 'mermaid', 'opa', 'dagu', 'bonita-bdm'];

export function resolveStudioConfig(env = process.env, cfg = {}) {
  const configured = env.ARTIFACT_STUDIO_ENABLED_ADAPTERS
    ? env.ARTIFACT_STUDIO_ENABLED_ADAPTERS.split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : cfg.studio?.enabledAdapters;

  const enabledAdapters = (Array.isArray(configured) ? configured : SUPPORTED_ADAPTERS).filter(
    (id, index, values) => SUPPORTED_ADAPTERS.includes(id) && values.indexOf(id) === index,
  );

  if (!enabledAdapters.length) enabledAdapters.push('bpmn');

  const requestedDefault =
    env.ARTIFACT_STUDIO_DEFAULT_ADAPTER || cfg.studio?.defaultAdapter || 'bpmn';
  const defaultAdapter = enabledAdapters.includes(requestedDefault)
    ? requestedDefault
    : enabledAdapters[0];

  return { defaultAdapter, enabledAdapters };
}
