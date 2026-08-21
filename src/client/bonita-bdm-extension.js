import sampleSource from '../../examples/bonita-bdm/bom.xml?raw';
import { getArtifactAdapter } from './artifact-adapters.js';
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
import { hostRuntime } from './host-runtime.js';

const descriptor = getArtifactAdapter('bonita-bdm');
const els = {
  adapter: document.querySelector('#adapter-select'),
  pane: document.querySelector('#bonita-bdm-pane'),
  source: document.querySelector('#bonita-bdm-source'),
  loadSample: document.querySelector('#bonita-bdm-load-sample'),
  objectList: document.querySelector('#bonita-bdm-object-list'),
  preview: document.querySelector('#bonita-bdm-preview'),
  canvas: document.querySelector('#canvas'),
  mermaidPane: document.querySelector('#mermaid-pane'),
  daguPane: document.querySelector('#dagu-pane'),
  opaPane: document.querySelector('#opa-pane'),
  prompt: document.querySelector('#process-prompt'),
  generate: document.querySelector('#generate-button'),
  validate: document.querySelector('#validate-button'),
  format: document.querySelector('#format-button'),
  export: document.querySelector('#export-button'),
  file: document.querySelector('#file-input'),
  status: document.querySelector('#status'),
  findings: document.querySelector('#findings'),
  findingCount: document.querySelector('#finding-count'),
  selectedHeading: document.querySelector('#selected-heading'),
  selected: document.querySelector('#selected-element'),
  review: document.querySelector('#review-button'),
};

let active = false;
let persistTimer = null;
let inspectTimer = null;
let inspectGeneration = 0;
let currentModel = null;
let selectedQualifiedName = null;

function restoredSource() {
  const content = readArtifactContent('bonita-bdm');
  return content?.kind === 'text' ? content.source : '';
}

els.source.value = restoredSource();

function setStatus(message) {
  if (active) els.status.textContent = message;
}

function hasSource() {
  return Boolean(els.source.value.trim());
}

function persistNow() {
  persistArtifactContent('bonita-bdm', textContent(els.source.value));
  notifyArtifactRuntimeChange();
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 120);
}

function api(action, body = {}) {
  return hostRuntime().artifactAction('bonita-bdm', action, {
    source: els.source.value,
    ...body,
  });
}

function findingSeverity(finding) {
  return finding.severity === 'warning' ? 'warning' : 'error';
}

function renderFindings(errors = [], warnings = []) {
  const findings = [
    ...errors.map((item) => ({ ...item, severity: 'error' })),
    ...warnings.map((item) => ({ ...item, severity: 'warning' })),
  ];
  els.findings.replaceChildren();
  els.findingCount.textContent = String(findings.length);
  if (!findings.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = hasSource() ? '検出事項はありません。' : '検証結果はここに表示されます。';
    els.findings.append(empty);
    return;
  }
  for (const finding of findings) {
    const card = document.createElement('div');
    card.className = `finding ${findingSeverity(finding)}`;
    const severity = document.createElement('div');
    severity.className = 'severity';
    severity.textContent = finding.severity === 'warning' ? '警告' : 'エラー';
    const message = document.createElement('div');
    message.className = 'message';
    message.textContent = finding.path ? `${finding.path} — ${finding.message}` : finding.message;
    card.append(severity, message);
    els.findings.append(card);
  }
}

function clearPreview(message = 'aggregation / composition の関係を表示します。') {
  els.preview.replaceChildren();
  const empty = document.createElement('span');
  empty.className = 'muted';
  empty.textContent = message;
  els.preview.append(empty);
}

function simpleFieldLabel(field) {
  const cardinality = field.collection ? '[]' : '';
  const required = field.nullable ? '' : ' *';
  const length = field.length ? `(${field.length})` : '';
  return `${field.name}: ${field.type}${length}${cardinality}${required}`;
}

function relationFieldLabel(field) {
  const cardinality = field.collection ? '[]' : '';
  const required = field.nullable ? '' : ' *';
  return `${field.name}: ${field.reference.split('.').at(-1)}${cardinality}${required}`;
}

function detailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'bonita-bdm-detail-row';
  const key = document.createElement('span');
  key.className = 'muted';
  key.textContent = label;
  const detail = document.createElement('span');
  detail.textContent = value;
  row.append(key, detail);
  return row;
}

function renderModelSummary() {
  els.selectedHeading.textContent = 'Bonita BDM';
  els.selected.className = '';
  els.selected.replaceChildren();
  if (!currentModel) {
    els.selected.className = 'muted';
    els.selected.textContent = hasSource()
      ? 'BDMを解析できませんでした。'
      : 'bom.xml を開いてください。';
    return;
  }
  els.selected.append(
    detailRow('Objects', String(currentModel.businessObjects.length)),
    detailRow('Model', currentModel.modelVersion || '-'),
    detailRow('Product', currentModel.productVersion || '-'),
  );
}

function renderSelectedObject() {
  const businessObject = currentModel?.businessObjects.find(
    (item) => item.qualifiedName === selectedQualifiedName,
  );
  if (!businessObject) {
    renderModelSummary();
    return;
  }
  els.selectedHeading.textContent = 'Business Object';
  els.selected.className = 'bonita-bdm-object-details';
  els.selected.replaceChildren();

  const name = document.createElement('div');
  name.className = 'selected-name';
  name.textContent = businessObject.simpleName;
  const qualifiedName = document.createElement('div');
  qualifiedName.className = 'muted bonita-bdm-qualified-name';
  qualifiedName.textContent = businessObject.qualifiedName;
  els.selected.append(name, qualifiedName);

  if (businessObject.description) {
    const description = document.createElement('div');
    description.className = 'bonita-bdm-description';
    description.textContent = businessObject.description;
    els.selected.append(description);
  }

  const fieldsHeading = document.createElement('div');
  fieldsHeading.className = 'bonita-bdm-detail-heading';
  fieldsHeading.textContent = 'Attributes';
  els.selected.append(fieldsHeading);

  for (const field of businessObject.fields) {
    const row = document.createElement('div');
    row.className = `bonita-bdm-field ${field.kind}`;
    const value = field.kind === 'relation' ? relationFieldLabel(field) : simpleFieldLabel(field);
    row.textContent = value;
    if (field.kind === 'relation') {
      const relation = document.createElement('span');
      relation.className = 'bonita-bdm-relation-badge';
      relation.textContent = `${field.relationType.toLowerCase()} · ${field.fetchType.toLowerCase()}`;
      row.append(relation);
    }
    els.selected.append(row);
  }

  if (businessObject.uniqueConstraints.length) {
    els.selected.append(
      detailRow(
        'Unique',
        businessObject.uniqueConstraints
          .map((item) => `${item.name}(${item.fieldNames.join(', ')})`)
          .join('; '),
      ),
    );
  }
  if (businessObject.indexes.length) {
    els.selected.append(
      detailRow(
        'Indexes',
        businessObject.indexes
          .map((item) => `${item.name}(${item.fieldNames.join(', ')})`)
          .join('; '),
      ),
    );
  }
  if (businessObject.queries.length) {
    els.selected.append(
      detailRow('Queries', businessObject.queries.map((item) => item.name).join(', ')),
    );
  }
}

function selectBusinessObject(qualifiedName) {
  selectedQualifiedName = qualifiedName;
  renderObjectList();
  renderSelectedObject();
}

function renderObjectList() {
  els.objectList.replaceChildren();
  if (!currentModel?.businessObjects.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = 'Business Object はありません。';
    els.objectList.append(empty);
    return;
  }
  for (const businessObject of currentModel.businessObjects) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bonita-bdm-object-button';
    button.classList.toggle('active', businessObject.qualifiedName === selectedQualifiedName);
    const name = document.createElement('strong');
    name.textContent = businessObject.simpleName;
    const detail = document.createElement('span');
    detail.textContent = `${businessObject.fields.length} attributes`;
    button.append(name, detail);
    button.addEventListener('click', () => selectBusinessObject(businessObject.qualifiedName));
    els.objectList.append(button);
  }
}

async function renderGraph(graph) {
  els.preview.replaceChildren();
  if (!graph?.nodes?.length) {
    clearPreview('Business Object はありません。');
    return;
  }
  try {
    await renderGraphProjection(graph, els.preview);
  } catch (error) {
    clearPreview(`Graph render error: ${error.message}`);
  }
}

async function inspectAndProject({ announce = false } = {}) {
  const generation = ++inspectGeneration;
  schedulePersist();
  if (!hasSource()) {
    currentModel = null;
    selectedQualifiedName = null;
    renderObjectList();
    renderModelSummary();
    renderFindings();
    clearPreview();
    syncActionStates();
    return false;
  }

  try {
    const inspected = await api('inspect');
    if (generation !== inspectGeneration) return false;
    currentModel = inspected.model;
    renderFindings(currentModel.errors || [], currentModel.warnings || []);
    if (
      !selectedQualifiedName ||
      !currentModel.businessObjects.some((item) => item.qualifiedName === selectedQualifiedName)
    ) {
      selectedQualifiedName = currentModel.businessObjects[0]?.qualifiedName || null;
    }
    renderObjectList();
    renderSelectedObject();

    if (currentModel.errors?.length) {
      clearPreview('構造エラーを修正すると relationship graph を表示できます。');
      if (announce) setStatus(`Bonita BDM: ${currentModel.errors.length}件のエラー`);
      syncActionStates();
      return false;
    }

    const projected = await api('project');
    if (generation !== inspectGeneration) return false;
    await renderGraph(projected.graph);
    if (announce) setStatus('Bonita BDM 検証・解析完了');
    syncActionStates();
    return true;
  } catch (error) {
    if (generation !== inspectGeneration) return false;
    currentModel = null;
    selectedQualifiedName = null;
    renderObjectList();
    renderModelSummary();
    renderFindings([{ message: error.message, code: error.code || 'BONITA_BDM_ERROR' }], []);
    clearPreview(error.message);
    if (announce) setStatus(`Bonita BDM エラー: ${error.message}`);
    syncActionStates();
    return false;
  }
}

function scheduleInspect() {
  if (!active) return;
  schedulePersist();
  clearTimeout(inspectTimer);
  inspectTimer = setTimeout(() => void inspectAndProject(), 300);
  syncActionStates();
}

async function validate() {
  const result = await api('check');
  renderFindings(result.errors || [], result.warnings || []);
  setStatus(
    result.errors?.length ? `Bonita BDM: ${result.errors.length}件のエラー` : 'Bonita BDM 検証完了',
  );
  return result;
}

function downloadSource() {
  const blob = new Blob([els.source.value], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = descriptor.exportFileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importFile(file) {
  if (!file) return;
  els.source.value = await file.text();
  persistNow();
  await inspectAndProject({ announce: true });
  setStatus(`${file.name} をBonita BDMとして読み込みました`);
}

async function loadSample() {
  if (hasSource() && els.source.value.trim() !== sampleSource.trim()) {
    const confirmed = window.confirm('現在のBonita BDMをサンプルで置き換えますか？');
    if (!confirmed) return;
  }
  els.source.value = sampleSource;
  persistNow();
  await inspectAndProject({ announce: true });
  setStatus('Bonita BDM サンプルを読み込みました');
}

function syncActionStates() {
  if (!active) return;
  const loaded = hasSource();
  els.validate.disabled = !loaded;
  els.format.disabled = true;
  els.export.disabled = !loaded;
  els.generate.disabled = true;
  els.review.disabled = true;
  els.prompt.disabled = true;
}

function syncUi() {
  const wasActive = active;
  active = els.adapter.value === 'bonita-bdm';
  els.pane.classList.toggle('hidden', !active);
  if (!active) return;

  els.canvas.classList.add('hidden');
  els.mermaidPane.classList.add('hidden');
  els.daguPane.classList.add('hidden');
  els.opaPane.classList.add('hidden');
  els.export.textContent = 'bom.xmlを書き出す';
  syncActionStates();
  if (!wasActive) void inspectAndProject();
}

window.addEventListener('as-code-studio:flush-active-artifact', () => {
  if (!active) return;
  clearTimeout(persistTimer);
  persistNow();
});

window.addEventListener('as-code-studio:active-artifact-changed', (event) => {
  syncUi();
  setTimeout(() => {
    syncUi();
    syncActionStates();
  }, 0);
  if (event.detail?.adapterId !== 'bonita-bdm') return;
  clearTimeout(persistTimer);
  clearTimeout(inspectTimer);
  els.source.value = restoredSource();
  currentModel = null;
  selectedQualifiedName = null;
  if (active) void inspectAndProject();
});

registerArtifactRuntime('bonita-bdm', {
  currentArtifact() {
    if (!hasSource()) return null;
    return currentArtifactRecord('bonita-bdm', textContent(els.source.value));
  },
  async project(artifact) {
    if (artifact?.content?.kind !== 'text') {
      throw new Error('Bonita BDM project requires text artifact content');
    }
    const result = await hostRuntime().artifactAction('bonita-bdm', 'project', {
      source: artifact.content.source,
    });
    if (!result.graph) throw new Error('Bonita BDM project did not return GraphProjection');
    return result.graph;
  },
  async semanticEntities(artifact) {
    if (artifact?.content?.kind !== 'text') {
      throw new Error('Bonita BDM semantic entities require text artifact content');
    }
    const result = await hostRuntime().artifactAction('bonita-bdm', 'entities', {
      source: artifact.content.source,
      artifactId: artifact.id,
    });
    if (!Array.isArray(result.entities)) {
      throw new Error('Bonita BDM semantic entity provider did not return entities');
    }
    return result.entities;
  },
});

els.source.addEventListener('input', scheduleInspect);
els.loadSample.addEventListener('click', () => {
  void loadSample().catch((error) => setStatus(`サンプル読み込みエラー: ${error.message}`));
});

els.validate.addEventListener(
  'click',
  (event) => {
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void validate().catch((error) => setStatus(`Bonita BDM validation エラー: ${error.message}`));
  },
  true,
);

els.format.addEventListener(
  'click',
  (event) => {
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);

els.export.addEventListener(
  'click',
  (event) => {
    if (!active) return;
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
    const bdmFile = Boolean(file && file.name.toLowerCase() === 'bom.xml');
    if (!active && !bdmFile) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (!active) {
      els.adapter.value = 'bonita-bdm';
      els.adapter.dispatchEvent(new Event('change', { bubbles: true }));
    }

    setTimeout(() => {
      syncUi();
      importFile(file)
        .catch((error) => setStatus(`Bonita BDM読み込みエラー: ${error.message}`))
        .finally(() => {
          els.file.value = '';
          syncActionStates();
        });
    }, 0);
  },
  true,
);

els.adapter.addEventListener('change', () => {
  const leaving = active && els.adapter.value !== 'bonita-bdm';
  if (leaving) persistNow();
  setTimeout(syncUi, 0);
});

const adapterObserver = new MutationObserver(() => setTimeout(syncUi, 0));
adapterObserver.observe(els.adapter, { childList: true });

window.addEventListener('beforeunload', () => {
  if (active) persistNow();
});

syncUi();
