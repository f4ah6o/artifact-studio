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
import { renderGraphProjection } from './graph-renderer.js';

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

function renderSelected() {
  if (!daguActive) return;
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
  detail.textContent = `${els.source.value.split('\n').length} lines`;
  els.selected.append(name, detail);
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
  els.preview.replaceChildren();
  const empty = document.createElement('span');
  empty.className = 'muted';
  empty.textContent = 'Dagu YAML の step dependency graph を表示します。';
  els.preview.append(empty);
}

function renderPreviewError(message) {
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
  els.validate.disabled = !loaded || !validateAvailable;
  els.format.disabled = true;
  els.export.disabled = !loaded;
  els.generate.disabled = true;
  els.review.disabled = true;
  els.prompt.disabled = true;
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
    setStatus('Dagu CLI 利用不可 — YAML編集・保存・書き出し・graph preview は利用できます');
  } else if (runtimeCapabilities.version) {
    setStatus(`Dagu validation 利用可能 — ${runtimeCapabilities.version}`);
  }
}

async function project({ announce = false } = {}) {
  if (!daguActive) return false;
  const source = els.source.value;
  const generation = ++projectGeneration;
  persistNow();
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
    els.preview.replaceChildren();
    await renderGraphProjection(result.graph, els.preview);
    if (generation !== projectGeneration) return false;
    if (announce) setStatus('Dagu dependency graph 更新完了');
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
  renderSelected();
  syncActionStates();
  clearTimeout(projectTimer);
  projectTimer = setTimeout(() => {
    project().catch((error) => setStatus(`Dagu graph preview エラー: ${error.message}`));
  }, 250);
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
  persistNow();
  renderFindings([]);
  await project({ announce: true });
  setStatus(`${file.name} を Dagu YAML として読み込みました`);
}

function syncUi() {
  const wasActive = daguActive;
  daguActive = els.adapter.value === 'dagu';
  els.pane.classList.toggle('hidden', !daguActive);
  if (!daguActive) return;

  els.canvas.classList.add('hidden');
  els.mermaidPane.classList.add('hidden');
  els.opaPane.classList.add('hidden');
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

renderPreviewEmpty();
syncUi();
