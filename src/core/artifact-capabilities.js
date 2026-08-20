export const CORE_ADAPTER_CAPABILITIES = Object.freeze(['validate', 'format', 'project']);

function uniqueStrings(values = []) {
  return Object.freeze([...new Set(values.map(String).filter(Boolean))]);
}

export function adapterCapabilities({
  validate = false,
  format = false,
  project = false,
  actions = [],
  views = [],
} = {}) {
  return Object.freeze({
    validate: Boolean(validate),
    format: Boolean(format),
    project: Boolean(project),
    actions: uniqueStrings(actions),
    views: uniqueStrings(views),
  });
}

export function supportsCapability(adapter, capability) {
  if (!CORE_ADAPTER_CAPABILITIES.includes(capability)) return false;
  return adapter?.capabilities?.[capability] === true;
}

export function supportsAction(adapter, action) {
  return (
    Array.isArray(adapter?.capabilities?.actions) && adapter.capabilities.actions.includes(action)
  );
}

export function supportsView(adapter, view) {
  return Array.isArray(adapter?.capabilities?.views) && adapter.capabilities.views.includes(view);
}
