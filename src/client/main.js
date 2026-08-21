import {
  artifactAdapters,
  getArtifactAdapter,
  inferAdapterFromFileName,
  loadArtifactAdapter,
} from './artifact-adapters.js';
import {
  activeArtifactRecord,
  artifactWorkspaceSnapshot,
  cleanupEmptyArtifactRecords,
  createArtifactRecord,
  currentArtifactRecord,
  listArtifactRecords,
  persistArtifactContent,
  persistArtifactRecord,
  readArtifactContent,
  readArtifactRecordById,
  removeArtifactRecord,
  renameArtifactRecord,
  reusableEmptyArtifact,
  replaceArtifactWorkspace,
  selectArtifactRecord,
  textContent,
  workspaceContent,
} from './artifact-content.js';
import {
  notifyArtifactRuntimeChange,
  registerArtifactRuntime,
} from './artifact-runtime-registry.js';
import {
  artifactDisplayTitle,
  artifactIsShellEmpty,
  nextAvailableArtifactTitle,
} from './artifact-lifecycle.js';
import { initArchitectureWorkspace } from './architecture-workspace.js';
import { hostRuntime } from './host-runtime.js';

const els = {
  adapterSelect: document.querySelector('#adapter-select'),
  artifactSelect: document.querySelector('#artifact-select'),
  newArtifact: document.querySelector('#new-artifact-button'),
  renameArtifact: document.querySelector('#rename-artifact-button'),
  deleteArtifact: document.querySelector('#delete-artifact-button'),
  adapterDescription: document.querySelector('#adapter-description'),
  prompt: document.querySelector('#process-prompt'),
  generate: document.querySelector('#generate-button'),
  validate: document.querySelector('#validate-button'),
  format: document.querySelector('#format-button'),
  export: document.querySelector('#export-button'),
  fileOpenLabel: document.querySelector('#file-open-label'),
  file: document.querySelector('#file-input'),
  canvas: document.querySelector('#canvas'),
  mermaidPane: document.querySelector('#mermaid-pane'),
  mermaidSource: document.querySelector('#mermaid-source'),
  mermaidPreview: document.querySelector('#mermaid-preview'),
  empty: document.querySelector('#empty-state'),
  status: document.querySelector('#status'),
  findings: document.querySelector('#findings'),
  findingCount: document.querySelector('#finding-count'),
  selectedHeading: document.querySelector('#selected-heading'),
  selected: document.querySelector('#selected-element'),
  review: document.querySelector('#review-button'),
  chatForm: document.querySelector('#chat-form'),
  chatInput: document.querySelector('#chat-input'),
  chatLog: document.querySelector('#chat-log'),
  codexState: document.querySelector('#codex-state'),
  codexLogin: document.querySelector('#codex-login-button'),
  codexModel: document.querySelector('#codex-model-select'),
  codexEffort: document.querySelector('#codex-effort-select'),
  aiSessionState: document.querySelector('#ai-session-state'),
  aiSessionReset: document.querySelector('#ai-session-reset-button'),
};

const adapterUiLoaders = Object.freeze({
  opa: () => import('./opa-extension.js'),
  dagu: () => import('./dagu-extension.js'),
  'bonita-bdm': () => import('./bonita-bdm-extension.js'),
});
const adapterUiPromises = new Map();

async function ensureAdapterUi(adapterId) {
  const loader = adapterUiLoaders[adapterId];
  if (!loader) return;
  if (!adapterUiPromises.has(adapterId)) {
    adapterUiPromises.set(
      adapterId,
      loader().catch((error) => {
        adapterUiPromises.delete(adapterId);
        throw error;
      }),
    );
  }
  await adapterUiPromises.get(adapterId);
}

let bpmnModeler = null;
let bpmnModelerPromise = null;

async function ensureBpmnModeler() {
  if (!bpmnModelerPromise) {
    bpmnModelerPromise = import('./bpmn-runtime.js')
      .then(({ createBpmnModeler }) => {
        const modeler = createBpmnModeler('#canvas');
        modeler.on('commandStack.changed', scheduleSync);
        modeler.on('selection.changed', (event) => {
          if (isBpmn()) renderSelected(event.newSelection?.[0] || null);
        });
        bpmnModeler = modeler;
        return modeler;
      })
      .catch((error) => {
        bpmnModelerPromise = null;
        throw error;
      });
  }
  return bpmnModelerPromise;
}

function currentBpmnModeler() {
  return bpmnModeler;
}

const state = {
  activeAdapter: 'bpmn',
  enabledAdapters: ['bpmn', 'mermaid'],
  appConfig: null,
  workspace: null,
  logicCore: null,
  validation: { errors: [], warnings: [] },
  diagramLoaded: false,
  suppressSync: false,
  syncTimer: null,
  mermaidRenderTimer: null,
  mermaidRenderGeneration: 0,
  chatHistories: new Map(),
  llmAvailable: false,
  codex: null,
};

function setStatus(message) {
  els.status.textContent = message;
}

function emptyContentForAdapter(adapterId) {
  const adapter = getArtifactAdapter(adapterId);
  return adapter.contentKind === 'workspace'
    ? workspaceContent({ files: {}, entrypoints: [], activeFile: null, inputFile: null })
    : textContent('');
}

function writeWorkspace() {
  try {
    state.workspace = replaceArtifactWorkspace(state.workspace || artifactWorkspaceSnapshot());
    return true;
  } catch (error) {
    console.warn('As-Code Studio workspaceの保存に失敗しました', error);
    return false;
  }
}

function readWorkspace() {
  return artifactWorkspaceSnapshot();
}

function syncWorkspaceState() {
  state.workspace = artifactWorkspaceSnapshot();
  return state.workspace;
}

function persistArtifact(adapterId, source) {
  persistArtifactContent(adapterId, textContent(String(source ?? '')));
  syncWorkspaceState();
  renderArtifactSelector();
  notifyArtifactRuntimeChange();
}

function nextArtifactTitle(adapterId) {
  return nextAvailableArtifactTitle(
    adapterId,
    getArtifactAdapter(adapterId)?.label || adapterId,
    listArtifactRecords(),
  );
}

function persistActiveAdapter(adapterId, artifactId = null) {
  let artifact = artifactId ? readArtifactRecordById(artifactId) : activeArtifactRecord();
  if (!artifact || artifact.adapterId !== adapterId) {
    artifact = listArtifactRecords().find((candidate) => candidate.adapterId === adapterId) || null;
  }
  if (!artifact) {
    artifact = createArtifactRecord(adapterId, emptyContentForAdapter(adapterId), undefined, {
      activate: true,
      title: nextArtifactTitle(adapterId),
    });
  } else if (activeArtifactRecord()?.id !== artifact.id) {
    artifact = selectArtifactRecord(artifact.id);
  }
  syncWorkspaceState();
  renderArtifactSelector();
  return artifact;
}

function storedArtifactSource(adapterId) {
  const content = readArtifactContent(adapterId);
  return content?.kind === 'text' ? content.source : null;
}

function createAiSessionId() {
  return (
    globalThis.crypto?.randomUUID?.() || `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function ensureAiSession(adapterId = state.activeAdapter) {
  state.workspace = artifactWorkspaceSnapshot();
  if (!state.workspace.aiSessions || typeof state.workspace.aiSessions !== 'object') {
    state.workspace.aiSessions = {};
  }

  let session = state.workspace.aiSessions[adapterId];
  if (!session || typeof session.id !== 'string' || !session.id) {
    session = {
      id: createAiSessionId(),
      model: null,
      effort: null,
      status: 'new',
    };
    state.workspace.aiSessions[adapterId] = session;
    writeWorkspace();
  }
  return session;
}

function currentAiSession() {
  return ensureAiSession(state.activeAdapter);
}

function replaceAiSession(adapterId = state.activeAdapter) {
  const previous = ensureAiSession(adapterId);
  const session = {
    id: createAiSessionId(),
    model: previous.model || null,
    effort: previous.effort || null,
    status: 'new',
  };
  state.workspace.aiSessions[adapterId] = session;
  writeWorkspace();
  return session;
}

function currentChatHistory() {
  const id = currentAiSession().id;
  if (!state.chatHistories.has(id)) state.chatHistories.set(id, []);
  return state.chatHistories.get(id);
}

function aiRequestPayload(payload = {}) {
  const session = currentAiSession();
  const model = els.codexModel?.value || session.model || state.codex?.model || null;
  const effort = els.codexEffort?.value || session.effort || state.codex?.effort || null;
  session.model = model;
  session.effort = effort;
  writeWorkspace();
  return {
    ...payload,
    aiSessionId: session.id,
    model,
    effort,
  };
}

function aiSessionStatusText(session) {
  if (!session) return 'Session: 新規';
  if (session.status === 'continuing') return 'Session: 継続中';
  if (session.status === 'recovered') return 'Session: 再接続時に新規contextへ回復';
  if (session.status === 'reset') return 'Session: リセット済み';
  return 'Session: 新規';
}

function applyAiSessionState(aiSession) {
  if (!aiSession || typeof aiSession.id !== 'string') return;
  const session = currentAiSession();
  if (session.id !== aiSession.id) return;
  if (typeof aiSession.model === 'string' && aiSession.model) session.model = aiSession.model;
  if (typeof aiSession.effort === 'string' && aiSession.effort) session.effort = aiSession.effort;
  session.status =
    aiSession.contextReset && aiSession.contextResetReason === 'stale_thread'
      ? 'recovered'
      : aiSession.status || 'new';
  writeWorkspace();
  renderAiControls();
}

function renderAiControls() {
  const models = Array.isArray(state.codex?.models) ? state.codex.models : [];
  const enabled = Boolean(state.llmAvailable && models.length);
  els.codexModel.disabled = !enabled;
  els.codexEffort.disabled = !enabled;
  els.aiSessionReset.disabled = !state.llmAvailable;

  if (!state.workspace) return;
  const session = currentAiSession();
  els.aiSessionState.textContent = aiSessionStatusText(session);

  els.codexModel.replaceChildren();
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model.model;
    option.textContent = `${model.displayName}${model.isDefault ? ' (default)' : ''}`;
    els.codexModel.append(option);
  }

  if (!models.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = state.codex?.model || '利用可能なmodelなし';
    els.codexModel.append(option);
    els.codexEffort.replaceChildren();
    const effortOption = document.createElement('option');
    effortOption.value = '';
    effortOption.textContent = state.codex?.effort || '—';
    els.codexEffort.append(effortOption);
    return;
  }

  let selectedModel = models.find((model) => model.model === session.model);
  if (!selectedModel) selectedModel = models.find((model) => model.model === state.codex?.model);
  if (!selectedModel) selectedModel = models.find((model) => model.isDefault) || models[0];
  session.model = selectedModel.model;
  els.codexModel.value = selectedModel.model;

  els.codexEffort.replaceChildren();
  const efforts = Array.isArray(selectedModel.supportedReasoningEfforts)
    ? selectedModel.supportedReasoningEfforts
    : [];
  for (const effort of efforts) {
    const option = document.createElement('option');
    option.value = effort.reasoningEffort;
    option.textContent = effort.reasoningEffort;
    option.title = effort.description || '';
    els.codexEffort.append(option);
  }

  const supported = new Set(efforts.map((effort) => effort.reasoningEffort));
  let selectedEffort = supported.has(session.effort) ? session.effort : null;
  if (
    !selectedEffort &&
    selectedModel.model === state.codex?.model &&
    supported.has(state.codex?.effort)
  ) {
    selectedEffort = state.codex.effort;
  }
  if (!selectedEffort && supported.has(selectedModel.defaultReasoningEffort)) {
    selectedEffort = selectedModel.defaultReasoningEffort;
  }
  if (!selectedEffort) selectedEffort = efforts[0]?.reasoningEffort || null;
  session.effort = selectedEffort;
  els.codexEffort.value = selectedEffort || '';
  writeWorkspace();
}

async function refreshAiSessionStatus() {
  if (!state.llmAvailable) return;
  const result = await api('/api/v1/ai/session/status', aiRequestPayload());
  applyAiSessionState(result.aiSession);
}

async function resetAiSession() {
  if (!state.llmAvailable) return;
  const session = currentAiSession();
  const result = await api('/api/v1/ai/session/reset', aiRequestPayload());
  state.chatHistories.set(session.id, []);
  applyAiSessionState(result.aiSession);
  renderChatHistory();
  setStatus('AI sessionをリセットしました');
}

function persistDiagramXml(xml) {
  persistArtifact('bpmn', xml);
}

function currentAdapter() {
  return getArtifactAdapter(state.activeAdapter);
}

function isBpmn() {
  return state.activeAdapter === 'bpmn';
}

function isArtifactLoaded() {
  if (isBpmn()) return state.diagramLoaded;
  if (state.activeAdapter === 'mermaid') return Boolean(els.mermaidSource.value.trim());
  return false;
}

async function api(path, body) {
  return hostRuntime().post(path, body);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractTargetIds(message) {
  if (!isBpmn() || !state.diagramLoaded || typeof message !== 'string') return [];
  const registry = currentBpmnModeler()?.get('elementRegistry');
  if (!registry) return [];
  const matches = [...message.matchAll(/"([a-zA-Z_][a-zA-Z0-9_-]*)"/g)].map((m) => m[1]);
  return [...new Set(matches.filter((id) => registry.get(id)))];
}

function allFindings() {
  return [
    ...asArray(state.validation.errors).map((message) => ({ severity: 'error', message })),
    ...asArray(state.validation.warnings).map((message) => ({ severity: 'warning', message })),
  ].map((finding, index) => ({ ...finding, index, targets: extractTargetIds(finding.message) }));
}

function focusElement(id) {
  if (!isBpmn()) return;
  const registry = currentBpmnModeler()?.get('elementRegistry');
  if (!registry) return;
  const element = registry.get(id);
  if (!element) return;
  const selection = currentBpmnModeler()?.get('selection');
  const canvas = currentBpmnModeler()?.get('canvas');
  if (!selection || !canvas) return;
  selection.select(element);
  if (typeof canvas.scrollToElement === 'function') canvas.scrollToElement(element);
}

function renderOverlays(findings) {
  if (!state.diagramLoaded) return;
  const overlays = currentBpmnModeler()?.get('overlays');
  if (!overlays) return;
  overlays.clear();
  if (!isBpmn()) return;

  const byTarget = new Map();
  for (const finding of findings) {
    for (const target of finding.targets) {
      const entry = byTarget.get(target) || { count: 0, severity: 'warning', first: finding.index };
      entry.count += 1;
      if (finding.severity === 'error') entry.severity = 'error';
      byTarget.set(target, entry);
    }
  }

  for (const [target, entry] of byTarget) {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = `ai-finding-badge ${entry.severity === 'warning' ? 'warning' : ''}`;
    badge.textContent = String(entry.count);
    badge.title = `検出事項 ${entry.count}件`;
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      focusElement(target);
      document
        .querySelector(`[data-finding-index="${entry.first}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
    overlays.add(target, { position: { top: -10, right: -10 }, html: badge });
  }
}

function renderFindings() {
  const findings = allFindings();
  els.findingCount.textContent = String(findings.length);
  els.findings.replaceChildren();

  if (findings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = isArtifactLoaded()
      ? '検出事項はありません。'
      : '検証結果はここに表示されます。';
    els.findings.append(empty);
    renderOverlays([]);
    return;
  }

  for (const finding of findings) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `finding ${finding.severity}`;
    card.dataset.findingIndex = String(finding.index);

    const severity = document.createElement('div');
    severity.className = 'severity';
    severity.textContent = finding.severity === 'error' ? 'エラー' : '警告';

    const message = document.createElement('div');
    message.className = 'message';
    message.textContent = finding.message;

    card.append(severity, message);

    if (finding.targets.length) {
      const targets = document.createElement('div');
      targets.className = 'targets';
      targets.textContent = finding.targets.join(', ');
      card.append(targets);
      card.addEventListener('click', () => focusElement(finding.targets[0]));
    }

    els.findings.append(card);
  }

  renderOverlays(findings);
}

function renderSelected(element) {
  els.selected.replaceChildren();

  if (!isBpmn()) {
    els.selectedHeading.textContent = 'Artifact';
    els.selected.className = '';
    const adapter = document.createElement('div');
    adapter.className = 'selected-id';
    adapter.textContent = currentAdapter()?.label || state.activeAdapter;
    const detail = document.createElement('div');
    detail.className = 'muted';
    const lines = els.mermaidSource.value ? els.mermaidSource.value.split('\n').length : 0;
    detail.textContent = lines ? `${lines} lines` : 'ソース未入力';
    els.selected.append(adapter, detail);
    return;
  }

  els.selectedHeading.textContent = '選択中';
  if (!element) {
    els.selected.className = 'muted';
    els.selected.textContent = 'BPMN要素を選択してください。';
    return;
  }

  els.selected.className = '';
  const id = document.createElement('div');
  id.className = 'selected-id';
  id.textContent = element.id;

  const type = document.createElement('div');
  type.className = 'muted';
  type.textContent = element.businessObject?.$type || element.type || '';

  const name = document.createElement('div');
  name.className = 'selected-name';
  name.textContent = element.businessObject?.name || '(名称なし)';

  els.selected.append(id, type, name);
}

function updateActionStates() {
  const loaded = isArtifactLoaded();
  const activeArtifact = activeArtifactRecord();
  els.generate.disabled = !state.llmAvailable;
  els.validate.disabled = !loaded;
  els.format.disabled = !loaded;
  els.export.disabled = !loaded;
  els.review.disabled = !state.llmAvailable || !loaded;
  els.renameArtifact.disabled = !activeArtifact;
  els.deleteArtifact.disabled = !activeArtifact;
}

function artifactOptionLabel(artifact) {
  const title = artifactDisplayTitle(
    artifact,
    getArtifactAdapter(artifact.adapterId)?.label || artifact.adapterId,
  );
  return `${title}${artifact.lineage ? ' · derived' : ''}`;
}

function normalizeArtifactTitles() {
  const artifacts = listArtifactRecords();
  for (const adapterId of new Set(artifacts.map((artifact) => artifact.adapterId))) {
    const adapter = getArtifactAdapter(adapterId);
    const base = adapter?.label || adapterId;
    const group = artifacts.filter((artifact) => artifact.adapterId === adapterId);
    const used = new Set(
      group.map((artifact) => artifact.title).filter((title) => title && title !== adapterId),
    );
    let ordinal = 1;
    for (const artifact of group) {
      if (artifact.title && artifact.title !== adapterId) continue;
      while (used.has(`${base} ${ordinal}`)) ordinal += 1;
      const title = `${base} ${ordinal}`;
      renameArtifactRecord(artifact.id, title);
      used.add(title);
      ordinal += 1;
    }
  }
}

function renderArtifactSelector() {
  const artifacts = listArtifactRecords().filter((artifact) =>
    state.enabledAdapters.includes(artifact.adapterId),
  );
  const active = activeArtifactRecord();
  els.artifactSelect.replaceChildren();
  for (const artifact of artifacts) {
    const option = document.createElement('option');
    option.value = artifact.id;
    option.textContent = artifactOptionLabel(artifact);
    els.artifactSelect.append(option);
  }
  if (!artifacts.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No artifacts';
    els.artifactSelect.append(option);
  }
  els.artifactSelect.disabled = !artifacts.length;
  if (active && artifacts.some((artifact) => artifact.id === active.id)) {
    els.artifactSelect.value = active.id;
  }
}

function flushArtifactEditors() {
  window.dispatchEvent(new CustomEvent('as-code-studio:flush-active-artifact'));
}

function updateAdapterUi() {
  const adapter = currentAdapter();
  if (!adapter) return;

  els.adapterSelect.value = adapter.id;
  els.adapterDescription.textContent = adapter.label;
  els.prompt.placeholder = adapter.promptPlaceholder || '';
  els.file.accept = adapter.accept || '';
  els.fileOpenLabel.textContent = `${adapter.label}を開く`;
  els.export.textContent = `${adapter.label}を書き出す`;

  const bpmn = adapter.id === 'bpmn';
  const mermaid = adapter.id === 'mermaid';
  els.canvas.classList.toggle('hidden', !bpmn);
  els.mermaidPane.classList.toggle('hidden', !mermaid);
  els.empty.classList.toggle('hidden', !bpmn || state.diagramLoaded);

  if (bpmn) {
    const selection = currentBpmnModeler()?.get('selection')?.get?.() || [];
    renderSelected(selection[0] || null);
  } else {
    renderSelected(null);
  }

  updateActionStates();
  renderArtifactSelector();
  renderAiControls();
}

function configureAdapters(studio = {}) {
  const configured = Array.isArray(studio.enabledAdapters)
    ? studio.enabledAdapters
    : Object.keys(artifactAdapters);
  const enabled = configured.filter((id) => Boolean(getArtifactAdapter(id)));
  state.enabledAdapters = enabled.length ? enabled : ['bpmn'];

  els.adapterSelect.replaceChildren();
  for (const id of state.enabledAdapters) {
    const adapter = getArtifactAdapter(id);
    const option = document.createElement('option');
    option.value = id;
    option.textContent = adapter.label;
    els.adapterSelect.append(option);
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function fitDiagramToViewport() {
  const modeler = await ensureBpmnModeler();
  await nextFrame();
  await nextFrame();
  const canvas = modeler.get('canvas');
  canvas.resized();
  canvas.zoom('fit-viewport');
}

async function importDiagram(xml, { persist = true } = {}) {
  const modeler = await ensureBpmnModeler();
  state.suppressSync = true;
  try {
    await modeler.importXML(xml);
    state.diagramLoaded = true;
    if (persist) persistDiagramXml(xml);
    updateAdapterUi();
    if (isBpmn()) await fitDiagramToViewport();
  } finally {
    state.suppressSync = false;
  }
}

async function syncLogicCore({ validate = true } = {}) {
  if (!state.diagramLoaded) return null;
  const modeler = await ensureBpmnModeler();
  setStatus('BPMN → Logic-Core 同期中…');
  const { xml } = await modeler.saveXML({ format: true });
  persistDiagramXml(xml);
  const imported = await api('/api/v1/import', { bpmnXml: xml });
  state.logicCore = imported.logicCore;

  if (validate) {
    const validated = await api('/api/v1/validate', { logicCore: state.logicCore });
    state.validation = validated.validation || { errors: [], warnings: [] };
    renderFindings();
  }

  setStatus('同期済み');
  return state.logicCore;
}

function scheduleSync() {
  if (!isBpmn() || state.suppressSync || !state.diagramLoaded) return;
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(() => {
    syncLogicCore().catch((error) => setStatus(`同期エラー: ${error.message}`));
  }, 600);
}

function renderMermaidError(message) {
  els.mermaidPreview.replaceChildren();
  const error = document.createElement('div');
  error.className = 'preview-error';
  error.textContent = message;
  els.mermaidPreview.append(error);
}

function renderMermaidEmpty() {
  els.mermaidPreview.replaceChildren();
  const empty = document.createElement('span');
  empty.className = 'muted';
  empty.textContent = 'Mermaidソースを入力またはAI生成してください。';
  els.mermaidPreview.append(empty);
}

async function renderMermaidCurrent({ announce = false } = {}) {
  const adapter = await loadArtifactAdapter('mermaid');
  const source = els.mermaidSource.value;
  const generation = ++state.mermaidRenderGeneration;
  persistArtifact('mermaid', source);
  renderSelected(null);
  updateActionStates();

  if (!source.trim()) {
    state.validation = { errors: [], warnings: [] };
    renderFindings();
    renderMermaidEmpty();
    return false;
  }

  const validation = await adapter.validate(source);
  if (generation !== state.mermaidRenderGeneration) return false;
  state.validation = validation;
  renderFindings();

  if (validation.errors.length) {
    renderMermaidError(validation.errors[0]);
    if (announce) setStatus(`Mermaid検証エラー: ${validation.errors[0]}`);
    return false;
  }

  try {
    await adapter.render(source, els.mermaidPreview);
    if (generation !== state.mermaidRenderGeneration) return false;
    if (announce) setStatus('Mermaid検証・描画完了');
    return true;
  } catch (error) {
    if (generation !== state.mermaidRenderGeneration) return false;
    state.validation = { errors: [error.message], warnings: [] };
    renderFindings();
    renderMermaidError(error.message);
    if (announce) setStatus(`Mermaid描画エラー: ${error.message}`);
    return false;
  }
}

function scheduleMermaidRender() {
  if (state.activeAdapter !== 'mermaid') return;
  persistArtifact('mermaid', els.mermaidSource.value);
  renderSelected(null);
  updateActionStates();
  clearTimeout(state.mermaidRenderTimer);
  state.mermaidRenderTimer = setTimeout(() => {
    renderMermaidCurrent().catch((error) => setStatus(`Mermaid描画エラー: ${error.message}`));
  }, 350);
}

async function persistCurrentArtifact() {
  if (isBpmn() && state.diagramLoaded) {
    const modeler = await ensureBpmnModeler();
    const { xml } = await modeler.saveXML({ format: true });
    persistDiagramXml(xml);
    return;
  }
  if (state.activeAdapter === 'mermaid') {
    persistArtifact('mermaid', els.mermaidSource.value);
  }
}

async function restoreAdapterArtifact(adapterId) {
  const source = storedArtifactSource(adapterId);
  if (source === null) return false;

  if (adapterId === 'bpmn') {
    const modeler = await ensureBpmnModeler();
    if (!source.trim()) {
      state.suppressSync = true;
      try {
        await modeler.createDiagram();
        state.diagramLoaded = true;
        updateAdapterUi();
        await fitDiagramToViewport();
      } finally {
        state.suppressSync = false;
      }
      return false;
    }
    try {
      await importDiagram(source, { persist: false });
      try {
        await syncLogicCore({ validate: true });
      } catch (error) {
        console.warn('復元したBPMNの同期に失敗しました', error);
      }
      return true;
    } catch (error) {
      console.warn('保存済みBPMNを復元できませんでした', error);
      return false;
    }
  }

  if (adapterId === 'mermaid') {
    els.mermaidSource.value = source;
    await renderMermaidCurrent();
    return Boolean(source.trim());
  }

  return false;
}

async function activateAdapter(
  adapterId,
  { restore = true, persistBeforeSwitch = true, announce = true, artifactId = null } = {},
) {
  if (!state.enabledAdapters.includes(adapterId)) return false;

  if (persistBeforeSwitch && (state.activeAdapter !== adapterId || artifactId)) {
    flushArtifactEditors();
    try {
      await persistCurrentArtifact();
    } catch (error) {
      console.warn('adapter切替前の保存に失敗しました', error);
    }
  }

  clearTimeout(state.syncTimer);
  clearTimeout(state.mermaidRenderTimer);
  state.activeAdapter = adapterId;
  state.validation = { errors: [], warnings: [] };
  if (adapterId === 'bpmn') await ensureBpmnModeler();
  await ensureAdapterUi(adapterId);
  persistActiveAdapter(adapterId, artifactId);
  updateAdapterUi();
  renderFindings();
  window.dispatchEvent(
    new CustomEvent('as-code-studio:active-artifact-changed', {
      detail: { artifactId: activeArtifactRecord()?.id || null, adapterId },
    }),
  );

  let restored = false;
  if (restore) {
    if (adapterId === 'bpmn' && state.diagramLoaded && !artifactId) {
      restored = true;
      await fitDiagramToViewport();
    } else {
      restored = await restoreAdapterArtifact(adapterId);
    }
  }

  updateAdapterUi();
  renderChatHistory();
  if (state.llmAvailable) {
    try {
      await refreshAiSessionStatus();
    } catch (error) {
      console.warn('AI session状態の取得に失敗しました', error);
    }
  }
  if (announce) setStatus(`${currentAdapter().label} adapterに切り替えました`);
  return restored;
}

async function generateFromText() {
  const userText = els.prompt.value.trim();
  if (!userText) return;

  els.generate.disabled = true;
  try {
    if (isBpmn()) {
      setStatus('CodexでBPMNを生成中…');
      const result = await api('/api/v1/orchestrate', aiRequestPayload({ userText }));
      applyAiSessionState(result.aiSession);
      if (!result.bpmnXml) throw new Error('BPMN XML was not returned');
      await importDiagram(result.bpmnXml);
      state.logicCore = result.logicCore;
      state.validation = result.validation || { errors: [], warnings: [] };
      renderFindings();
      setStatus('BPMN生成完了');
      return;
    }

    if (state.activeAdapter === 'mermaid') {
      setStatus('CodexでMermaidを生成中…');
      const result = await api(
        '/api/v1/artifacts/mermaid/generate',
        aiRequestPayload({ userText }),
      );
      applyAiSessionState(result.aiSession);
      if (!result.source) throw new Error('Mermaid source was not returned');
      els.mermaidSource.value = result.source;
      persistArtifact('mermaid', result.source);
      await renderMermaidCurrent();
      setStatus(
        state.validation.errors.length ? 'Mermaid生成完了 / 構文エラーあり' : 'Mermaid生成完了',
      );
    }
  } catch (error) {
    setStatus(`生成エラー: ${error.message}`);
  } finally {
    updateActionStates();
  }
}

async function validateCurrent() {
  try {
    if (isBpmn()) {
      await syncLogicCore({ validate: true });
      setStatus('BPMN検証完了');
      return;
    }

    if (state.activeAdapter === 'mermaid') {
      await renderMermaidCurrent({ announce: true });
    }
  } catch (error) {
    setStatus(`検証エラー: ${error.message}`);
  }
}

async function formatCurrent() {
  if (!isArtifactLoaded()) return;

  if (isBpmn()) {
    clearTimeout(state.syncTimer);
    els.format.disabled = true;
    setStatus('BPMNを整形中…');

    try {
      const logicCore = await syncLogicCore({ validate: false });
      const result = await api('/api/v1/generate', {
        logicCore,
        visualRefinement: true,
      });
      if (!result.bpmnXml) throw new Error('整形済みBPMN XMLが返されませんでした');

      await importDiagram(result.bpmnXml);
      state.logicCore = logicCore;
      state.validation = result.validation || { errors: [], warnings: [] };
      renderFindings();
      setStatus('BPMN整形完了');
    } catch (error) {
      setStatus(`整形エラー: ${error.message}`);
    } finally {
      updateActionStates();
    }
    return;
  }

  if (state.activeAdapter === 'mermaid') {
    const adapter = await loadArtifactAdapter('mermaid');
    const formatted = adapter.format(els.mermaidSource.value);
    els.mermaidSource.value = formatted;
    persistArtifact('mermaid', formatted);
    await renderMermaidCurrent();
    setStatus('Mermaidソースを整形しました');
  }
}

function downloadSource(source, fileName, type = 'text/plain') {
  const blob = new Blob([source], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportCurrent() {
  if (!isArtifactLoaded()) return;

  try {
    if (isBpmn()) {
      const modeler = await ensureBpmnModeler();
      const { xml } = await modeler.saveXML({ format: true });
      persistDiagramXml(xml);
      downloadSource(xml, artifactAdapters.bpmn.exportFileName, 'application/xml');
      return;
    }

    if (state.activeAdapter === 'mermaid') {
      const source = els.mermaidSource.value;
      persistArtifact('mermaid', source);
      downloadSource(source, artifactAdapters.mermaid.exportFileName, 'text/plain');
    }
  } catch (error) {
    setStatus(`書き出しエラー: ${error.message}`);
  }
}

function appendChat(role, text, { record = true } = {}) {
  const node = document.createElement('div');
  node.className = role === 'user' ? 'user-message' : 'assistant-message';
  node.textContent = text;
  els.chatLog.append(node);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
  if (record) currentChatHistory().push({ role, content: text });
}

function renderChatHistory() {
  if (!state.workspace) return;
  const history = currentChatHistory();
  els.chatLog.replaceChildren();
  if (!history.length) {
    appendChat(
      'assistant',
      'artifactを作成した後、「現在のartifactをレビュー」で未定義事項や改善点を確認できます。',
      { record: false },
    );
    return;
  }
  for (const message of history) appendChat(message.role, message.content, { record: false });
}

async function currentArtifactContext() {
  if (isBpmn()) {
    if (state.diagramLoaded) await syncLogicCore({ validate: false });
    return state.logicCore
      ? `Current BPMN Logic-Core JSON:\n${JSON.stringify(state.logicCore)}`
      : 'No BPMN artifact is currently loaded.';
  }

  if (state.activeAdapter === 'mermaid') {
    return `Current Mermaid source:\n${els.mermaidSource.value}`;
  }

  return '';
}

async function askAi(question, { showUser = true } = {}) {
  if (!state.llmAvailable) throw new Error('Codexに接続されていません');

  if (showUser) appendChat('user', question);

  const artifactContext = await currentArtifactContext();
  const messages = [{ role: 'user', content: `${question}\n\n${artifactContext}` }];

  const result = await api('/api/v1/chat', aiRequestPayload({ messages }));
  applyAiSessionState(result.aiSession);
  appendChat('assistant', result.reply);
  return result;
}

async function reviewCurrent() {
  if (!isArtifactLoaded()) return;
  els.review.disabled = true;
  setStatus('Codexレビュー中…');
  try {
    const question = isBpmn()
      ? 'この既存BPMNをレビューしてください。構造上のlintでは検出できない、業務上もっとも重要な未定義事項を1つ質問してください。可能なら関係するBPMN element IDを明示してください。'
      : 'このMermaid図をレビューしてください。構文検証では分からない、意味上の欠落・曖昧さ・改善点のうち最も重要なものを1つ指摘してください。';
    await askAi(question, { showUser: false });
    setStatus('Codexレビュー完了');
  } catch (error) {
    setStatus(`Codexレビューエラー: ${error.message}`);
  } finally {
    updateActionStates();
  }
}

async function handleChatSubmit(event) {
  event.preventDefault();
  const question = els.chatInput.value.trim();
  if (!question) return;
  els.chatInput.value = '';
  try {
    await askAi(question);
  } catch (error) {
    appendChat('assistant', `エラー: ${error.message}`);
  }
}

async function handleFile(file) {
  if (!file) return;
  try {
    const inferred = inferAdapterFromFileName(file.name);
    if (inferred && state.enabledAdapters.includes(inferred) && inferred !== state.activeAdapter) {
      await activateAdapter(inferred);
    }

    replaceAiSession(state.activeAdapter);
    renderAiControls();
    renderChatHistory();

    const source = await file.text();
    if (isBpmn()) {
      await importDiagram(source);
      await syncLogicCore({ validate: true });
    } else if (state.activeAdapter === 'mermaid') {
      els.mermaidSource.value = source;
      persistArtifact('mermaid', source);
      await renderMermaidCurrent();
    }
    setStatus(`${file.name} を読み込みました`);
  } catch (error) {
    setStatus(`読み込みエラー: ${error.message}`);
  } finally {
    els.file.value = '';
    updateActionStates();
  }
}

function applyCodexStatus(codex) {
  state.codex = codex || null;
  state.llmAvailable = Boolean(codex?.available && codex?.authenticated);

  if (!codex?.available) {
    els.codexState.textContent = 'Codex app-server: 利用不可';
    els.codexLogin.hidden = true;
    updateActionStates();
    renderAiControls();
    return;
  }

  if (!codex.authenticated) {
    els.codexState.textContent = 'Codex: 未ログイン';
    els.codexLogin.hidden = false;
    updateActionStates();
    renderAiControls();
    return;
  }

  const plan = codex.planType ? ` / ${codex.planType}` : '';
  els.codexState.textContent = `Codex: 接続済み${plan}`;
  els.codexLogin.hidden = true;
  updateActionStates();
  renderAiControls();
}

async function refreshAppConfig() {
  const config = await hostRuntime().getConfig();
  state.appConfig = config;
  configureAdapters(config.studio || {});
  applyCodexStatus(config.codex);
  return config;
}

async function loginCodex() {
  els.codexLogin.disabled = true;
  const authWindow = window.open('about:blank', '_blank');
  if (authWindow) authWindow.opener = null;

  try {
    const result = await api('/api/v1/codex/login', {});
    if (!result.authUrl) throw new Error('Codex app-server did not return authUrl');

    if (authWindow) authWindow.location.href = result.authUrl;
    else window.open(result.authUrl, '_blank', 'noopener,noreferrer');

    setStatus('ChatGPTログイン完了待ち…');
    for (let i = 0; i < 60; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const config = await refreshAppConfig();
        if (config.codex?.available && config.codex?.authenticated) {
          setStatus('Codex接続完了');
          return;
        }
      } catch {
        // Keep polling while the login flow is active.
      }
    }
    setStatus('ログイン状態を確認できませんでした');
  } catch (error) {
    if (authWindow) authWindow.close();
    setStatus(`Codexログインエラー: ${error.message}`);
  } finally {
    els.codexLogin.disabled = false;
  }
}

els.adapterSelect.addEventListener('change', () => {
  activateAdapter(els.adapterSelect.value).catch((error) =>
    setStatus(`adapter切替エラー: ${error.message}`),
  );
});
els.artifactSelect.addEventListener('change', () => {
  const artifact = readArtifactRecordById(els.artifactSelect.value);
  if (!artifact) return;
  activateAdapter(artifact.adapterId, { artifactId: artifact.id, announce: false }).catch((error) =>
    setStatus(`artifact切替エラー: ${error.message}`),
  );
});
els.newArtifact.addEventListener('click', () => {
  flushArtifactEditors();
  Promise.resolve(persistCurrentArtifact())
    .then(() => {
      const reusable = reusableEmptyArtifact(state.activeAdapter, {
        isEmpty: artifactIsShellEmpty,
      });
      if (reusable) return selectArtifactRecord(reusable.id);
      return createArtifactRecord(
        state.activeAdapter,
        emptyContentForAdapter(state.activeAdapter),
        undefined,
        {
          activate: true,
          title: nextArtifactTitle(state.activeAdapter),
        },
      );
    })
    .then((artifact) => {
      syncWorkspaceState();
      return activateAdapter(artifact.adapterId, {
        artifactId: artifact.id,
        restore: true,
        persistBeforeSwitch: false,
        announce: false,
      });
    })
    .then(() => setStatus(`${currentAdapter().label} の空Artifactを準備しました`))
    .catch((error) => setStatus(`Artifact作成エラー: ${error.message}`));
});

els.renameArtifact.addEventListener('click', () => {
  const artifact = activeArtifactRecord();
  if (!artifact) return;
  const title = window.prompt(
    'Artifact名',
    artifactOptionLabel(artifact).replace(/ · derived$/, ''),
  );
  if (title == null) return;
  try {
    const renamed = renameArtifactRecord(artifact.id, title);
    syncWorkspaceState();
    renderArtifactSelector();
    updateActionStates();
    setStatus(`Artifact名を「${renamed.title}」に変更しました`);
    notifyArtifactRuntimeChange();
  } catch (error) {
    setStatus(`Artifact名変更エラー: ${error.message}`);
  }
});

els.deleteArtifact.addEventListener('click', () => {
  const artifact = activeArtifactRecord();
  if (!artifact) return;
  if (!window.confirm(`Artifact「${artifactOptionLabel(artifact)}」を削除しますか？`)) return;
  flushArtifactEditors();
  Promise.resolve()
    .then(() => removeArtifactRecord(artifact.id))
    .then(async () => {
      syncWorkspaceState();
      const next = activeArtifactRecord() || persistActiveAdapter(state.activeAdapter);
      await activateAdapter(next.adapterId, {
        artifactId: next.id,
        restore: true,
        persistBeforeSwitch: false,
        announce: false,
      });
      notifyArtifactRuntimeChange();
      setStatus(`Artifact「${artifactOptionLabel(artifact)}」を削除しました`);
    })
    .catch((error) => setStatus(`Artifact削除エラー: ${error.message}`));
});
els.codexModel.addEventListener('change', () => {
  const session = currentAiSession();
  session.model = els.codexModel.value || null;
  session.effort = null;
  session.status ||= 'new';
  writeWorkspace();
  renderAiControls();
});
els.codexEffort.addEventListener('change', () => {
  const session = currentAiSession();
  session.effort = els.codexEffort.value || null;
  writeWorkspace();
});
els.aiSessionReset.addEventListener('click', () => {
  resetAiSession().catch((error) => setStatus(`AI sessionリセットエラー: ${error.message}`));
});
els.generate.addEventListener('click', generateFromText);
els.validate.addEventListener('click', validateCurrent);
els.format.addEventListener('click', formatCurrent);
els.export.addEventListener('click', exportCurrent);
els.file.addEventListener('change', () => handleFile(els.file.files?.[0]));
els.mermaidSource.addEventListener('input', scheduleMermaidRender);
els.review.addEventListener('click', reviewCurrent);
els.chatForm.addEventListener('submit', handleChatSubmit);
registerArtifactRuntime('bpmn', {
  async currentArtifact() {
    if (!state.diagramLoaded) return null;
    const modeler = await ensureBpmnModeler();
    const { xml } = await modeler.saveXML({ format: true });
    return currentArtifactRecord('bpmn', textContent(xml));
  },
  async semanticEntities(artifact) {
    if (artifact?.content?.kind !== 'text') {
      throw new Error('BPMN semantic entities require text artifact content');
    }
    const result = await hostRuntime().artifactAction('bpmn', 'entities', {
      source: artifact.content.source,
      artifactId: artifact.id,
    });
    if (!Array.isArray(result.entities)) {
      throw new Error('BPMN semantic entity provider did not return entities');
    }
    return result.entities;
  },
});

registerArtifactRuntime('mermaid', {
  currentArtifact() {
    const source = els.mermaidSource.value;
    if (!source.trim()) return null;
    return currentArtifactRecord('mermaid', textContent(source));
  },
  async openArtifact(artifact) {
    if (artifact?.content?.kind !== 'text') {
      throw new Error('Mermaid requires text artifact content');
    }
    persistArtifactRecord(artifact);
    els.mermaidSource.value = artifact.content.source;
    persistArtifact('mermaid', artifact.content.source);
    await activateAdapter('mermaid', { restore: false, announce: false });
    await renderMermaidCurrent();
    setStatus('Derived Mermaid artifact を開きました');
    return currentArtifactRecord('mermaid', textContent(els.mermaidSource.value));
  },
});

initArchitectureWorkspace({ ensureArtifactRuntime: ensureAdapterUi });

els.codexLogin.addEventListener('click', loginCodex);

async function bootstrap() {
  const removedEmptyArtifacts = cleanupEmptyArtifactRecords({ isEmpty: artifactIsShellEmpty });
  normalizeArtifactTitles();
  state.workspace = readWorkspace();
  if (removedEmptyArtifacts.length) {
    console.info(`Removed ${removedEmptyArtifacts.length} duplicate empty artifacts`);
  }

  let config = null;
  try {
    config = await refreshAppConfig();
  } catch (error) {
    console.warn(error);
    configureAdapters({ defaultAdapter: 'bpmn', enabledAdapters: ['bpmn', 'mermaid'] });
    applyCodexStatus({ available: false, authenticated: false, error: error.message });
  }

  const configuredDefault = config?.studio?.defaultAdapter || 'bpmn';
  const storedArtifact = activeArtifactRecord();
  const storedAdapter = storedArtifact?.adapterId || null;
  const initialAdapter = state.enabledAdapters.includes(storedAdapter)
    ? storedAdapter
    : state.enabledAdapters.includes(configuredDefault)
      ? configuredDefault
      : state.enabledAdapters[0];

  const restored = await activateAdapter(initialAdapter, {
    restore: true,
    persistBeforeSwitch: false,
    announce: false,
    artifactId: storedAdapter === initialAdapter ? storedArtifact?.id || null : null,
  });

  if (restored) {
    setStatus(`前回の${currentAdapter().label}を復元しました`);
  } else if (state.llmAvailable) {
    setStatus(`準備完了 — ${currentAdapter().label} / Codex app-server`);
  } else if (state.codex?.available) {
    setStatus(`${currentAdapter().label}の編集・検証は利用可能 / AI利用にはChatGPTログインが必要`);
  } else {
    setStatus(`${currentAdapter().label}の編集・検証は利用可能 / Codex app-serverを利用できません`);
  }
}

void bootstrap();
