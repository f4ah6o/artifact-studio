import { isMap, isScalar, isSeq, parseAllDocuments, YAMLMap, YAMLSeq } from 'yaml';

export class DaguVisualEditError extends Error {
  constructor(message, code = 'DAGU_VISUAL_EDIT_UNSAFE') {
    super(message);
    this.name = 'DaguVisualEditError';
    this.code = code;
  }
}

function scalarText(node) {
  if (node == null) return '';
  if (!isScalar(node)) return null;
  return node.value == null ? '' : String(node.value);
}

function sequenceValues(node) {
  if (node == null) return [];
  if (isScalar(node)) {
    const value = scalarText(node);
    return value ? [value] : [];
  }
  if (!isSeq(node)) return null;
  const values = [];
  for (const item of node.items) {
    const value = scalarText(item);
    if (value == null) return null;
    if (value) values.push(value);
  }
  return values;
}

function parseSource(source) {
  const text = String(source ?? '');
  const documents = parseAllDocuments(text.trim() ? text : '{}\n', {
    prettyErrors: false,
    strict: false,
    uniqueKeys: true,
  });
  if (documents.length !== 1) {
    return {
      editable: false,
      reason: 'Visual editing supports a single Dagu YAML document.',
      documents,
      document: documents[0] || null,
      root: null,
      stepsNode: null,
    };
  }

  const document = documents[0];
  if (document.errors.length) {
    return {
      editable: false,
      reason: document.errors[0].message,
      documents,
      document,
      root: null,
      stepsNode: null,
    };
  }

  const root = document.contents;
  if (root != null && !isMap(root)) {
    return {
      editable: false,
      reason: 'Visual editing requires a top-level YAML mapping.',
      documents,
      document,
      root: null,
      stepsNode: null,
    };
  }

  const stepsNode = root?.get('steps', true) ?? null;
  if (stepsNode != null && !isSeq(stepsNode)) {
    return {
      editable: false,
      reason: 'Visual editing requires steps to be a YAML sequence.',
      documents,
      document,
      root,
      stepsNode,
    };
  }

  return { editable: true, reason: null, documents, document, root, stepsNode };
}

function retryPolicyModel(node) {
  if (node == null) {
    return {
      present: false,
      editable: true,
      limit: '',
      intervalSec: '',
      backoff: '',
      maxIntervalSec: '',
    };
  }
  if (!isMap(node)) return { present: true, editable: false };

  const values = {};
  for (const [field, property] of [
    ['limit', 'limit'],
    ['interval_sec', 'intervalSec'],
    ['backoff', 'backoff'],
    ['max_interval_sec', 'maxIntervalSec'],
  ]) {
    const value = scalarText(node.get(field, true));
    if (value == null) return { present: true, editable: false };
    values[property] = value;
  }
  return { present: true, editable: true, ...values };
}

function stepModel(stepNode, index) {
  if (!isMap(stepNode)) {
    return { editable: false, reason: `Step ${index + 1} is not a YAML mapping.`, index };
  }

  const id = scalarText(stepNode.get('id', true));
  const name = scalarText(stepNode.get('name', true));
  const run = scalarText(stepNode.get('run', true));
  const timeout = scalarText(stepNode.get('timeout_sec', true));
  const depends = sequenceValues(stepNode.get('depends', true));
  const retryPolicy = retryPolicyModel(stepNode.get('retry_policy', true));

  if (id == null || name == null) {
    return {
      editable: false,
      reason: `Step ${index + 1} uses a non-scalar id or name.`,
      index,
    };
  }
  if (depends == null) {
    return {
      editable: false,
      reason: `Step ${id || name || index + 1} uses a depends shape that cannot be edited safely.`,
      index,
    };
  }

  return {
    editable: true,
    index,
    id,
    name,
    identity: id || name,
    run: run ?? '',
    runEditable: run != null,
    timeoutSec: timeout ?? '',
    timeoutEditable: timeout != null,
    depends,
    retryPolicy,
  };
}

export function daguVisualNodeId(documentIndex, step) {
  const identity = step.id || step.name;
  return identity
    ? `dagu:${documentIndex}:step:${encodeURIComponent(identity)}`
    : `dagu:${documentIndex}:anonymous:${step.index}`;
}

export function inspectDaguYaml(source) {
  const parsed = parseSource(source);
  if (!parsed.editable) return { editable: false, reason: parsed.reason, steps: [] };

  const steps = (parsed.stepsNode?.items || []).map(stepModel);
  const unsafeStep = steps.find((step) => !step.editable);
  if (unsafeStep) return { editable: false, reason: unsafeStep.reason, steps };

  const aliases = new Map();
  for (const step of steps) {
    for (const alias of [step.id, step.name].filter(Boolean)) {
      if (aliases.has(alias)) {
        return {
          editable: false,
          reason: `Step alias is ambiguous: ${alias}`,
          steps,
        };
      }
      aliases.set(alias, step.index);
    }
  }

  return { editable: true, reason: null, steps };
}

function editableDocument(source) {
  const parsed = parseSource(source);
  if (!parsed.editable) throw new DaguVisualEditError(parsed.reason);

  const model = inspectDaguYaml(source);
  if (!model.editable) throw new DaguVisualEditError(model.reason);

  let root = parsed.root;
  if (!root) {
    root = new YAMLMap();
    parsed.document.contents = root;
  }

  let steps = parsed.stepsNode;
  if (!steps) {
    steps = new YAMLSeq();
    root.set('steps', steps);
  }

  return { document: parsed.document, root, steps, model };
}

function stepAt(steps, index) {
  const step = steps.items[index];
  if (!isMap(step)) throw new DaguVisualEditError(`Step ${index + 1} is not editable.`);
  return step;
}

function stringify(document) {
  return document.toString({ lineWidth: 0 });
}

function nextStepId(model) {
  const used = new Set(model.steps.flatMap((step) => [step.id, step.name]).filter(Boolean));
  let index = model.steps.length + 1;
  while (used.has(`step_${index}`)) index += 1;
  return `step_${index}`;
}

function setOptionalScalar(map, key, value) {
  const normalized = String(value ?? '').trim();
  if (normalized) map.set(key, normalized);
  else map.delete(key);
}

function setOptionalTypedScalar(map, key, value, { boolean = false } = {}) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    map.delete(key);
    return;
  }
  if (/^-?\d+$/.test(normalized)) {
    const number = Number(normalized);
    if (Number.isSafeInteger(number)) {
      map.set(key, number);
      return;
    }
  }
  if (boolean && (normalized === 'true' || normalized === 'false')) {
    map.set(key, normalized === 'true');
    return;
  }
  map.set(key, normalized);
}

function setDepends(map, values) {
  const normalized = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  if (!normalized.length) {
    map.delete('depends');
    return;
  }
  if (normalized.length === 1) {
    map.set('depends', normalized[0]);
    return;
  }
  const sequence = new YAMLSeq();
  sequence.flow = true;
  sequence.items = normalized;
  map.set('depends', sequence);
}

function setRetryPolicy(map, values) {
  const existing = map.get('retry_policy', true);
  if (existing != null && !isMap(existing)) return;
  const retry = existing || new YAMLMap();
  setOptionalTypedScalar(retry, 'limit', values.limit);
  setOptionalTypedScalar(retry, 'interval_sec', values.intervalSec);
  setOptionalTypedScalar(retry, 'backoff', values.backoff, { boolean: true });
  setOptionalTypedScalar(retry, 'max_interval_sec', values.maxIntervalSec);
  if (!existing) map.set('retry_policy', retry);
}

function rewriteDependencyAliases(steps, oldAlias, newAlias) {
  if (!oldAlias || oldAlias === newAlias) return;
  for (const item of steps.items) {
    if (!isMap(item)) continue;
    const values = sequenceValues(item.get('depends', true));
    if (!values?.includes(oldAlias)) continue;
    setDepends(
      item,
      values.map((value) => (value === oldAlias ? newAlias : value)).filter(Boolean),
    );
  }
}

export function addDaguStep(source) {
  const { document, steps, model } = editableDocument(source);
  const step = new YAMLMap();
  const id = nextStepId(model);
  step.set('id', id);
  step.set('run', 'echo TODO');
  steps.add(step);
  return { source: stringify(document), selectedStepIndex: steps.items.length - 1 };
}

export function deleteDaguStep(source, stepIndex) {
  const { document, steps, model } = editableDocument(source);
  const step = model.steps[stepIndex];
  if (!step) throw new DaguVisualEditError('Select a step to delete.');
  const aliases = new Set([step.id, step.name].filter(Boolean));

  steps.items.splice(stepIndex, 1);
  for (const item of steps.items) {
    if (!isMap(item)) continue;
    const values = sequenceValues(item.get('depends', true));
    if (!values) continue;
    setDepends(
      item,
      values.filter((value) => !aliases.has(value)),
    );
  }

  return stringify(document);
}

export function updateDaguStep(source, stepIndex, values) {
  const { document, steps, model } = editableDocument(source);
  const existing = model.steps[stepIndex];
  if (!existing) throw new DaguVisualEditError('Select a step to edit.');
  const step = stepAt(steps, stepIndex);

  const oldIdentity = existing.id || existing.name;
  const nextId = String(values.id ?? '').trim();
  const nextName = String(values.name ?? '').trim();
  const nextIdentity = nextId || nextName;
  if (!nextIdentity) throw new DaguVisualEditError('A step requires id or name.');

  const occupied = model.steps.some(
    (candidate) =>
      candidate.index !== stepIndex &&
      [candidate.id, candidate.name].filter(Boolean).includes(nextIdentity),
  );
  if (occupied) throw new DaguVisualEditError(`Step alias is already in use: ${nextIdentity}`);

  setOptionalScalar(step, 'id', nextId);
  setOptionalScalar(step, 'name', nextName);

  if (existing.runEditable) setOptionalScalar(step, 'run', values.run);
  if (existing.timeoutEditable) setOptionalTypedScalar(step, 'timeout_sec', values.timeoutSec);
  setDepends(step, values.depends || []);
  if (values.retryPolicy && existing.retryPolicy?.editable) {
    setRetryPolicy(step, values.retryPolicy);
  }

  rewriteDependencyAliases(steps, oldIdentity, nextIdentity);
  return stringify(document);
}

export function addDaguDependency(source, fromStepIndex, toStepIndex) {
  const { document, steps, model } = editableDocument(source);
  if (fromStepIndex === toStepIndex)
    throw new DaguVisualEditError('A step cannot depend on itself.');
  const from = model.steps[fromStepIndex];
  const to = model.steps[toStepIndex];
  if (!from || !to) throw new DaguVisualEditError('Select two valid steps.');
  if (!from.identity) throw new DaguVisualEditError('The dependency source needs an id or name.');

  const target = stepAt(steps, toStepIndex);
  setDepends(target, [...to.depends, from.identity]);
  return stringify(document);
}

export function removeDaguDependency(source, fromStepIndex, toStepIndex) {
  const { document, steps, model } = editableDocument(source);
  const from = model.steps[fromStepIndex];
  const to = model.steps[toStepIndex];
  if (!from || !to || !from.identity) throw new DaguVisualEditError('Select a valid dependency.');

  const target = stepAt(steps, toStepIndex);
  setDepends(
    target,
    to.depends.filter((value) => value !== from.identity),
  );
  return stringify(document);
}
