import { getArtifactAdapter, supportsCapability } from './artifact-adapters.js';
import {
  currentArtifactRecord,
  persistArtifactContent,
  readArtifactContent,
  textContent,
} from './artifact-content.js';
import {
  notifyArtifactRuntimeChange,
  registerArtifactRuntime,
} from './artifact-runtime-registry.js';
import {
  addDaguDependency,
  addDaguStep,
  daguVisualNodeId,
  deleteDaguStep,
  inspectDaguYaml,
  removeDaguDependency,
  updateDaguStep,
} from './dagu-yaml-editor.js';
import { renderDaguVisualGraph } from './dagu-visual-renderer.js';

const descriptor = getArtifactAdapter('dagu');
const els = {
  adapter: document.querySelector('#adapter-select'),
  pane: document.querySelector('#dagu-pane'),
  mermaidPane: document.querySelector('#mermaid-pane'),
  opaPane: document.querySelector('#opa-pane'),
  canvas: document.querySelector('#canvas'),
  prompt: document.querySelector('#process-prompt'),
  generate: document.querySelector('#generate-button'),
  validate: document.querySelector('#validate-button'),
  format: document.querySelector('#format-button'),
  export: document.querySelector('#export-button'),
  file: document.querySelector('#file-input'),
  source: document.querySelector('#dagu-source'),
  preview: document.querySelector('#dagu-preview'),
  addStep: document.querySelector('#dagu-add-step'),
  connectStep: document.querySelector('#dagu-connect-step'),
  deleteStep: document.querySelector('#dagu-delete-step'),
  status: document.querySelector('#status'),
  findings: document.querySelector('#findings'),
  findingCount: document.querySelector('#finding-count'),
  selectedHeading: document.querySelector('#selected-heading'),
  selected: document.querySelector('#selected-element'),
  review: document.querySelector('#review-button'),
};

let daguActive = false;
let persistTimer = null;
let projectTimer = null;
let projectGeneration = 0;
let selectedStepIndex = null;
let connectFromStepIndex = null;
let currentGraph = null;
let visualModel = { editable: true, reason: null, steps: [] };
let runtimeCapabilities = {
  validate: { available: null, reason: null },
  project: { available: true, reason: null },
  version: null,
};

function restoredSource() {
  const content = readArtifactContent('dagu');
  return content?.kind === 'text' ? content.source : '';
}

els.source.value = restoredSource();

function setStatus(message) {
  if (daguActive) els.status.textContent = message;
}

function persistNow() {
  persistArtifactContent('dagu', textContent(els.source.value));
  notifyArtifactRuntimeChange();
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 120);
}

function hasSource() {
  return Boolean(els.source.value.trim());
}

function refreshVisualModel() {
  visualModel = inspectDaguYaml(els.source.value);
  if (selectedStepIndex != null && !visualModel.steps[selectedStepIndex]) selectedStepIndex = null;
  if (connectFromStepIndex != null && !visualModel.steps[connectFromStepIndex]) {
    connectFromStepIndex = null;
  }
  return visualModel;
}

function makeField(labelText, input) {
  const label = document.createElement('label');
  label.className = 'dagu-property-field';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = labelText;
  label.append(labelSpan, input);
  return label;
}

function textInput(value, { disabled = false, placeholder = '' } = {}) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value ?? '';
  input.disabled = disabled;
  input.placeholder = placeholder;
  return input;
}

function renderWorkflowSummary() {
  els.selectedHeading.textContent = 'Dagu workflow';
  els.selected.replaceChildren();
  if (!hasSource()) {
    els.selected.className = 'muted';
    els.selected.textContent = 'Dagu YAML を入力または開いてください。';
    return;
  }

  els.selected.className = '';
  const name = document.createElement('div');
  name.className = 'selected-id';
  name.textContent = descriptor.exportFileName;
  const detail = document.createElement('div');
  detail.className = 'muted';
  detail.textContent = `${els.source.value.split('\n').length} lines · ${visualModel.steps.length} steps`;
  els.selected.append(name, detail);

  if (!visualModel.editable) {
    const warning = document.createElement('div');
    warning.className = 'dagu-visual-warning';
    warning.textContent = `Visual editing is read-only: ${visualModel.reason}`;
    els.selected.append(warning);
  }
}

function dependencySourceIndex(alias) {
  return visualModel.steps.findIndex((step) =>
    [step.id, step.name].filter(Boolean).includes(alias),
  );
}

function renderSelectedStep() {
  const step = visualModel.steps[selectedStepIndex];
  if (!step || !step.editable) {
    renderWorkflowSummary();
    return;
  }

  els.selectedHeading.textContent = 'Dagu step';
  els.selected.className = 'dagu-step-properties';
  els.selected.replaceChildren();

  const id = textInput(step.id, { placeholder: 'step id' });
  const name = textInput(step.name, { placeholder: 'optional display name' });
  const run = textInput(step.run, { disabled: !step.runEditable, placeholder: 'command' });
  const timeout = textInput(step.timeoutSec, {
    disabled: !step.timeoutEditable,
    placeholder: 'seconds',
  });
  const depends = document.createElement('textarea');
  depends.rows = 3;
  depends.value = step.depends.join('\n');
  depends.placeholder = 'one dependency per line';

  const retryInputs =
    step.retryPolicy?.present && step.retryPolicy.editable
      ? {
          limit: textInput(step.retryPolicy.limit, { placeholder: 'retries' }),
          intervalSec: textInput(step.retryPolicy.intervalSec, { placeholder: 'seconds' }),
          backoff: textInput(step.retryPolicy.backoff, { placeholder: 'true or multiplier' }),
          maxIntervalSec: textInput(step.retryPolicy.maxIntervalSec, { placeholder: 'seconds' }),
        }
      : null;

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'button primary dagu-property-apply';
  apply.textContent = 'Apply';
  apply.addEventListener('click', () => {
    try {
      const source = updateDaguStep(els.source.value, selectedStepIndex, {
        id: id.value,
        name: name.value,
        run: run.value,
        timeoutSec: timeout.value,
        depends: depends.value
          .split(/[\n,]/)
          .map((value) => value.trim())
          .filter(Boolean),
        retryPolicy: retryInputs
          ? {
              limit: retryInputs.limit.value,
              intervalSec: retryInputs.intervalSec.value,
              backoff: retryInputs.backoff.value,
              maxIntervalSec: retryInputs.maxIntervalSec.value,
            }
          : undefined,
      });
      replaceSource(source, { announce: 'Step properties updated' });
    } catch (error) {
      setStatus(`Dagu visual edit error: ${error.message}`);
    }
  });

  const propertyFields = [
    makeField('ID', id),
    makeField('Name', name),
    makeField('Run', run),
    makeField('Timeout (sec)', timeout),
    makeField('Depends', depends),
  ];
  if (retryInputs) {
    propertyFields.push(
      makeField('Retry limit', retryInputs.limit),
      makeField('Retry interval (sec)', retryInputs.intervalSec),
      makeField('Retry backoff', retryInputs.backoff),
      makeField('Retry max interval (sec)', retryInputs.maxIntervalSec),
    );
  }
  els.selected.append(...propertyFields);
  if (step.retryPolicy?.present && !step.retryPolicy.editable) {
    const warning = document.createElement('div');
    warning.className = 'dagu-visual-warning';
    warning.textContent =
      'retry_policy is preserved but cannot be edited safely in the visual form.';
    els.selected.append(warning);
  }
  els.selected.append(apply);

  if (step.depends.length) {
    const heading = document.createElement('div');
    heading.className = 'dagu-dependency-heading';
    heading.textContent = 'Connections';
    const list = document.createElement('div');
    list.className = 'dagu-dependency-list';
    for (const dependency of step.depends) {
      const row = document.createElement('div');
      row.className = 'dagu-dependency-row';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = `${dependency} → ${step.identity || step.name || `Step ${step.index + 1}`}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link-button';
      remove.textContent = 'Remove';
      const fromIndex = dependencySourceIndex(dependency);
      remove.disabled = fromIndex < 0;
      remove.addEventListener('click', () => {
        try {
          const source = removeDaguDependency(els.source.value, fromIndex, selectedStepIndex);
          replaceSource(source, { announce: 'Dependency removed' });
        } catch (error) {
          setStatus(`Dagu visual edit error: ${error.message}`);
        }
      });
      row.append(nameSpan, remove);
      list.append(row);
    }
    els.selected.append(heading, list);
  }
}

function renderSelected() {
  if (!daguActive) return;
  refreshVisualModel();
  if (selectedStepIndex == null) renderWorkflowSummary();
  else renderSelectedStep();
}

function renderFindings(findings = []) {
  if (!daguActive) return;
  els.findings.replaceChildren();
  els.findingCount.textContent = String(findings.length);
  if (!findings.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = hasSource()
      ? 'Dagu validation の検出事項はありません。'
      : '検証結果はここに表示されます。';
    els.findings.append(empty);
    return;
  }

  for (const finding of findings) {
    const card = document.createElement('div');
    card.className = `finding ${finding.severity === 'warning' ? 'warning' : 'error'}`;
    const severity = document.createElement('div');
    severity.className = 'severity';
    severity.textContent = finding.severity === 'warning' ? '警告' : 'エラー';
    const message = document.createElement('div');
    message.className = 'message';
    const location = [finding.file, finding.line, finding.column]
      .filter((value) => value != null)
      .join(':');
    message.textContent = location ? `${location} — ${finding.message}` : finding.message;
    card.append(severity, message);
    els.findings.append(card);
  }
}

function renderPreviewEmpty() {
  currentGraph = null;
  els.preview.replaceChildren();
  const empty = document.createElement('span');
  empty.className = 'muted';
  empty.textContent = 'Dagu YAML の step dependency graph を表示します。';
  els.preview.append(empty);
}

function renderPreviewError(message) {
  currentGraph = null;
  els.preview.replaceChildren();
  const error = document.createElement('div');
  error.className = 'preview-error';
  error.textContent = message;
  els.preview.append(error);
}

async function api(action, body, { method = 'POST' } = {}) {
  const response = await fetch(`/api/v1/artifacts/dagu/${action}`, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `${response.status} ${response.statusText}`);
    error.code = data.code;
    throw error;
  }
  return data;
}

function syncActionStates() {
  if (!daguActive) return;
  const loaded = hasSource();
  const validateAvailable =
    supportsCapability(descriptor, 'validate') && runtimeCapabilities.validate?.available === true;
  const editable = visualModel.editable;
  els.validate.disabled = !loaded || !validateAvailable;
  els.format.disabled = true;
  els.export.disabled = !loaded;
  els.generate.disabled = true;
  els.review.disabled = true;
  els.prompt.disabled = true;
  els.addStep.disabled = !editable;
  els.connectStep.disabled = !editable || selectedStepIndex == null;
  els.deleteStep.disabled = !editable || selectedStepIndex == null;
  els.connectStep.classList.toggle('active', connectFromStepIndex != null);
}

async function refreshCapabilities() {
  if (!daguActive) return;
  try {
    const result = await api('capabilities', undefined, { method: 'GET' });
    runtimeCapabilities = result.capabilities || runtimeCapabilities;
  } catch (error) {
    runtimeCapabilities = {
      validate: { available: false, reason: error.code || 'DAGU_API_UNAVAILABLE' },
      project: { available: true, reason: null },
      version: null,
    };
  }
  syncActionStates();
  if (!runtimeCapabilities.validate?.available) {
    setStatus('Dagu CLI 利用不可 — YAML編集・visual DAG編集・保存・書き出しは利用できます');
  } else if (runtimeCapabilities.version) {
    setStatus(`Dagu validation 利用可能 — ${runtimeCapabilities.version}`);
  }
}

function nodeIndexMap() {
  const map = new Map();
  for (const step of visualModel.steps) {
    map.set(daguVisualNodeId(0, step), step.index);
  }
  return map;
}

async function renderCurrentGraph() {
  if (!currentGraph) return;
  await renderDaguVisualGraph(currentGraph, els.preview, {
    nodeIndexById: nodeIndexMap(),
    selectedStepIndex,
    connectFromStepIndex,
    editable: visualModel.editable,
    onSelect: handleGraphSelection,
  });
}

async function handleGraphSelection(stepIndex) {
  if (!daguActive) return;
  if (connectFromStepIndex != null) {
    const fromIndex = connectFromStepIndex;
    if (fromIndex === stepIndex) {
      setStatus('接続先として別のstepを選択してください');
      return;
    }
    try {
      const source = addDaguDependency(els.source.value, fromIndex, stepIndex);
      connectFromStepIndex = null;
      selectedStepIndex = stepIndex;
      replaceSource(source, { announce: 'Dependency added' });
    } catch (error) {
      connectFromStepIndex = null;
      setStatus(`Dagu visual edit error: ${error.message}`);
      await renderCurrentGraph();
      syncActionStates();
    }
    return;
  }

  selectedStepIndex = stepIndex;
  renderSelected();
  syncActionStates();
  await renderCurrentGraph();
}

async function project({ announce = false } = {}) {
  if (!daguActive) return false;
  const source = els.source.value;
  const generation = ++projectGeneration;
  persistNow();
  refreshVisualModel();
  renderSelected();
  syncActionStates();

  if (!source.trim()) {
    renderPreviewEmpty();
    return false;
  }
  if (!supportsCapability(descriptor, 'project')) {
    renderPreviewError('この adapter は graph projection を公開していません。');
    return false;
  }

  try {
    const result = await api('project', { source });
    if (generation !== projectGeneration) return false;
    if (!result.graph?.nodes?.length) {
      renderPreviewEmpty();
      if (announce) setStatus('Dagu YAML に構造化可能な steps がありません');
      return false;
    }
    currentGraph = result.graph;
    await renderCurrentGraph();
    if (generation !== projectGeneration) return false;
    if (announce) {
      setStatus(
        visualModel.editable
          ? 'Dagu visual dependency graph updated'
          : `Dagu graph is read-only: ${visualModel.reason}`,
      );
    }
    return true;
  } catch (error) {
    if (generation !== projectGeneration) return false;
    renderPreviewError(error.message);
    if (announce) setStatus(`Dagu graph preview エラー: ${error.message}`);
    return false;
  }
}

function scheduleProject() {
  if (!daguActive) return;
  schedulePersist();
  refreshVisualModel();
  renderSelected();
  syncActionStates();
  clearTimeout(projectTimer);
  projectTimer = setTimeout(() => {
    project().catch((error) => setStatus(`Dagu graph preview エラー: ${error.message}`));
  }, 250);
}

function replaceSource(source, { announce = null } = {}) {
  els.source.value = source;
  persistNow();
  renderFindings([]);
  refreshVisualModel();
  renderSelected();
  syncActionStates();
  project({ announce: false })
    .then(() => {
      if (announce) setStatus(announce);
    })
    .catch((error) => setStatus(`Dagu graph preview エラー: ${error.message}`));
}

async function validate() {
  if (!runtimeCapabilities.validate?.available) {
    setStatus('Dagu CLI が見つからないため authoritative validation は利用できません');
    return;
  }
  setStatus('dagu validate 実行中…');
  try {
    const result = await api('check', { source: els.source.value });
    renderFindings(result.findings || []);
    setStatus(
      result.ok ? 'dagu validate 完了' : `dagu validate: ${result.findings?.length || 0}件のエラー`,
    );
  } catch (error) {
    if (error.code === 'DAGU_UNAVAILABLE') {
      runtimeCapabilities.validate = { available: false, reason: error.code };
      renderFindings([]);
      setStatus('Dagu CLI が見つからないため authoritative validation は利用できません');
      syncActionStates();
      return;
    }
    throw error;
  }
}

function downloadSource() {
  persistNow();
  const blob = new Blob([els.source.value], { type: 'application/yaml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = descriptor.exportFileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function importFile(file) {
  els.source.value = await file.text();
  selectedStepIndex = null;
  connectFromStepIndex = null;
  persistNow();
  renderFindings([]);
  await project({ announce: true });
  setStatus(`${file.name} を Dagu YAML として読み込みました`);
}

function addStep() {
  try {
    const result = addDaguStep(els.source.value);
    selectedStepIndex = result.selectedStepIndex;
    connectFromStepIndex = null;
    replaceSource(result.source, { announce: 'Step added' });
  } catch (error) {
    setStatus(`Dagu visual edit error: ${error.message}`);
  }
}

function deleteStep() {
  try {
    const previousIndex = selectedStepIndex;
    const source = deleteDaguStep(els.source.value, previousIndex);
    const nextModel = inspectDaguYaml(source);
    selectedStepIndex = nextModel.steps.length
      ? Math.min(previousIndex, nextModel.steps.length - 1)
      : null;
    connectFromStepIndex = null;
    replaceSource(source, { announce: 'Step deleted' });
  } catch (error) {
    setStatus(`Dagu visual edit error: ${error.message}`);
  }
}

function toggleConnect() {
  if (selectedStepIndex == null) return;
  connectFromStepIndex = connectFromStepIndex == null ? selectedStepIndex : null;
  syncActionStates();
  renderCurrentGraph().catch((error) => setStatus(`Dagu graph render error: ${error.message}`));
  setStatus(
    connectFromStepIndex == null
      ? 'Dependency connect cancelled'
      : '接続先stepをクリックしてください（選択step → 接続先step）',
  );
}

function syncUi() {
  const wasActive = daguActive;
  daguActive = els.adapter.value === 'dagu';
  els.pane.classList.toggle('hidden', !daguActive);
  if (!daguActive) return;

  els.canvas.classList.add('hidden');
  els.mermaidPane.classList.add('hidden');
  els.opaPane.classList.add('hidden');
  refreshVisualModel();
  renderSelected();
  renderFindings([]);
  syncActionStates();

  if (!wasActive) {
    project().catch((error) => setStatus(`Dagu graph preview エラー: ${error.message}`));
    refreshCapabilities().catch((error) =>
      setStatus(`Dagu capability 確認エラー: ${error.message}`),
    );
  }
}

window.addEventListener('artifact-studio:flush-active-artifact', () => {
  if (!daguActive) return;
  clearTimeout(persistTimer);
  persistNow();
});

window.addEventListener('artifact-studio:active-artifact-changed', (event) => {
  syncUi();
  if (event.detail?.adapterId !== 'dagu') return;
  clearTimeout(persistTimer);
  clearTimeout(projectTimer);
  els.source.value = restoredSource();
  selectedStepIndex = null;
  connectFromStepIndex = null;
  currentGraph = null;
  if (daguActive) {
    refreshVisualModel();
    renderSelected();
    renderFindings([]);
    syncActionStates();
    project().catch((error) => setStatus(`Dagu graph preview エラー: ${error.message}`));
  }
});

registerArtifactRuntime('dagu', {
  currentArtifact() {
    if (!hasSource()) return null;
    return currentArtifactRecord('dagu', textContent(els.source.value));
  },
  async project(artifact) {
    if (artifact?.content?.kind !== 'text') {
      throw new Error('Dagu project requires text artifact content');
    }
    const result = await api('project', { source: artifact.content.source });
    if (!result.graph) throw new Error('Dagu project did not return GraphProjection');
    return result.graph;
  },
});

els.source.addEventListener('input', scheduleProject);
els.addStep.addEventListener('click', addStep);
els.connectStep.addEventListener('click', toggleConnect);
els.deleteStep.addEventListener('click', deleteStep);

els.validate.addEventListener(
  'click',
  (event) => {
    if (!daguActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    validate()
      .catch((error) => setStatus(`Dagu validation エラー: ${error.message}`))
      .finally(syncActionStates);
  },
  true,
);

els.format.addEventListener(
  'click',
  (event) => {
    if (!daguActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);

els.export.addEventListener(
  'click',
  (event) => {
    if (!daguActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    downloadSource();
  },
  true,
);

els.file.addEventListener(
  'change',
  (event) => {
    const file = els.file.files?.[0];
    const daguFile = Boolean(file && /\.ya?ml$/i.test(file.name));
    if (!daguActive && !daguFile) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (!daguActive) {
      els.adapter.value = 'dagu';
      els.adapter.dispatchEvent(new Event('change', { bubbles: true }));
    }

    setTimeout(() => {
      syncUi();
      importFile(file)
        .catch((error) => setStatus(`Dagu読み込みエラー: ${error.message}`))
        .finally(() => {
          els.file.value = '';
          syncActionStates();
        });
    }, 0);
  },
  true,
);

els.adapter.addEventListener('change', () => {
  const leavingDagu = daguActive && els.adapter.value !== 'dagu';
  if (leavingDagu) persistNow();
  setTimeout(syncUi, 0);
});

const adapterObserver = new MutationObserver(() => setTimeout(syncUi, 0));
adapterObserver.observe(els.adapter, { childList: true });
const codexObserver = new MutationObserver(() => {
  if (daguActive) syncActionStates();
});
codexObserver.observe(document.querySelector('#codex-state'), { childList: true, subtree: true });

window.addEventListener('beforeunload', () => {
  if (daguActive) persistNow();
});

refreshVisualModel();
renderPreviewEmpty();
syncUi();
