import BpmnModeler from 'bpmn-js/lib/Modeler';
import translations from 'bpmn-js-i18n/translations/ja.js';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import { artifactAdapters, getArtifactAdapter, inferAdapterFromFileName, loadArtifactAdapter } from './artifact-adapters.js';

const WORKSPACE_STORAGE_KEY = 'artifact-studio:workspace:v1';
const LAST_ARTIFACT_STORAGE_KEY = 'artifact-studio:last-artifact:v1';
const LEGACY_BPMN_STORAGE_KEY = 'ai-bpmn-modeler:last-diagram:v1';

function translate(template, replacements = {}) {
  const translated = translations[template] || template;
  return translated.replace(/{([^}]+)}/g, (_, key) => replacements[key] || `{${key}}`);
}

const japaneseTranslateModule = {
  translate: ['value', translate],
};

const modeler = new BpmnModeler({
  container: '#canvas',
  additionalModules: [japaneseTranslateModule],
});

const els = {
  adapterSelect: document.querySelector('#adapter-select'),
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
};

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
  chatHistory: [],
  llmAvailable: false,
  codex: null,
};

function setStatus(message) {
  els.status.textContent = message;
}

function emptyWorkspace() {
  return {
    version: 1,
    activeAdapter: null,
    artifacts: {},
  };
}

function writeWorkspace() {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state.workspace));
    return true;
  } catch (error) {
    console.warn('Artifact Studio workspaceの保存に失敗しました', error);
    return false;
  }
}

function readWorkspace() {
  const workspace = emptyWorkspace();

  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      if (stored?.version === 1 && stored.artifacts && typeof stored.artifacts === 'object') {
        return {
          version: 1,
          activeAdapter: typeof stored.activeAdapter === 'string' ? stored.activeAdapter : null,
          artifacts: stored.artifacts,
        };
      }
    }

    const previous = localStorage.getItem(LAST_ARTIFACT_STORAGE_KEY);
    if (previous) {
      const stored = JSON.parse(previous);
      if (typeof stored?.adapter === 'string' && typeof stored?.source === 'string') {
        workspace.activeAdapter = stored.adapter;
        workspace.artifacts[stored.adapter] = {
          source: stored.source,
          updatedAt: stored.updatedAt || new Date().toISOString(),
        };
      }
    }

    if (!workspace.artifacts.bpmn) {
      const legacyRaw = localStorage.getItem(LEGACY_BPMN_STORAGE_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        if (legacy?.version === 1 && typeof legacy.xml === 'string' && legacy.xml.trim()) {
          workspace.activeAdapter ||= 'bpmn';
          workspace.artifacts.bpmn = {
            source: legacy.xml,
            updatedAt: legacy.savedAt || new Date().toISOString(),
          };
        }
      }
    }
  } catch (error) {
    console.warn('保存済みworkspaceの読み込みに失敗しました', error);
  }

  return workspace;
}

function persistArtifact(adapterId, source) {
  if (!state.workspace) state.workspace = emptyWorkspace();
  state.workspace.artifacts[adapterId] = {
    source: String(source ?? ''),
    updatedAt: new Date().toISOString(),
  };
  writeWorkspace();
}

function persistActiveAdapter(adapterId) {
  if (!state.workspace) state.workspace = emptyWorkspace();
  state.workspace.activeAdapter = adapterId;
  if (writeWorkspace()) {
    localStorage.removeItem(LAST_ARTIFACT_STORAGE_KEY);
    localStorage.removeItem(LEGACY_BPMN_STORAGE_KEY);
  }
}

function storedArtifactSource(adapterId) {
  const source = state.workspace?.artifacts?.[adapterId]?.source;
  return typeof source === 'string' ? source : null;
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
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const summary = data.error || data.status || `${response.status} ${response.statusText}`;
    const details = Array.isArray(data.errors)
      ? data.errors.map(error => `${error.path || '(root)'}: ${error.message}`).join('; ')
      : '';
    throw new Error(details ? `${summary}: ${details}` : summary);
  }
  return data;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function extractTargetIds(message) {
  if (!isBpmn() || !state.diagramLoaded || typeof message !== 'string') return [];
  const registry = modeler.get('elementRegistry');
  const matches = [...message.matchAll(/"([a-zA-Z_][a-zA-Z0-9_-]*)"/g)].map(m => m[1]);
  return [...new Set(matches.filter(id => registry.get(id)))];
}

function allFindings() {
  return [
    ...asArray(state.validation.errors).map(message => ({ severity: 'error', message })),
    ...asArray(state.validation.warnings).map(message => ({ severity: 'warning', message })),
  ].map((finding, index) => ({ ...finding, index, targets: extractTargetIds(finding.message) }));
}

function focusElement(id) {
  if (!isBpmn()) return;
  const registry = modeler.get('elementRegistry');
  const element = registry.get(id);
  if (!element) return;
  const selection = modeler.get('selection');
  const canvas = modeler.get('canvas');
  selection.select(element);
  if (typeof canvas.scrollToElement === 'function') canvas.scrollToElement(element);
}

function renderOverlays(findings) {
  if (!state.diagramLoaded) return;
  const overlays = modeler.get('overlays');
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
    badge.addEventListener('click', event => {
      event.stopPropagation();
      focusElement(target);
      document.querySelector(`[data-finding-index="${entry.first}"]`)?.scrollIntoView({ block: 'nearest' });
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
    empty.textContent = isArtifactLoaded() ? '検出事項はありません。' : '検証結果はここに表示されます。';
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
  els.generate.disabled = !state.llmAvailable;
  els.validate.disabled = !loaded;
  els.format.disabled = !loaded;
  els.export.disabled = !loaded;
  els.review.disabled = !state.llmAvailable || !loaded;
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
  els.canvas.classList.toggle('hidden', !bpmn);
  els.mermaidPane.classList.toggle('hidden', bpmn);
  els.empty.classList.toggle('hidden', !bpmn || state.diagramLoaded);

  if (bpmn) {
    const selection = modeler.get('selection')?.get?.() || [];
    renderSelected(selection[0] || null);
  } else {
    renderSelected(null);
  }

  updateActionStates();
}

function configureAdapters(demo = {}) {
  const configured = Array.isArray(demo.enabledAdapters) ? demo.enabledAdapters : Object.keys(artifactAdapters);
  const enabled = configured.filter(id => Boolean(getArtifactAdapter(id)));
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
  return new Promise(resolve => requestAnimationFrame(resolve));
}

async function fitDiagramToViewport() {
  await nextFrame();
  await nextFrame();
  const canvas = modeler.get('canvas');
  canvas.resized();
  canvas.zoom('fit-viewport');
}

async function importDiagram(xml, { persist = true } = {}) {
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
    syncLogicCore().catch(error => setStatus(`同期エラー: ${error.message}`));
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
    renderMermaidCurrent().catch(error => setStatus(`Mermaid描画エラー: ${error.message}`));
  }, 350);
}

async function persistCurrentArtifact() {
  if (isBpmn() && state.diagramLoaded) {
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
    if (!source.trim()) return false;
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

async function activateAdapter(adapterId, {
  restore = true,
  persistBeforeSwitch = true,
  announce = true,
} = {}) {
  if (!state.enabledAdapters.includes(adapterId)) return false;

  if (persistBeforeSwitch && state.activeAdapter !== adapterId) {
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
  persistActiveAdapter(adapterId);
  updateAdapterUi();
  renderFindings();

  let restored = false;
  if (restore) {
    if (adapterId === 'bpmn' && state.diagramLoaded) {
      restored = true;
      await fitDiagramToViewport();
    } else {
      restored = await restoreAdapterArtifact(adapterId);
    }
  }

  updateAdapterUi();
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
      const result = await api('/api/v1/orchestrate', { userText });
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
      const result = await api('/api/v1/artifacts/mermaid/generate', { userText });
      if (!result.source) throw new Error('Mermaid source was not returned');
      els.mermaidSource.value = result.source;
      persistArtifact('mermaid', result.source);
      await renderMermaidCurrent();
      setStatus(state.validation.errors.length ? 'Mermaid生成完了 / 構文エラーあり' : 'Mermaid生成完了');
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

function appendChat(role, text) {
  const node = document.createElement('div');
  node.className = role === 'user' ? 'user-message' : 'assistant-message';
  node.textContent = text;
  els.chatLog.append(node);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
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

  const recent = state.chatHistory.slice(-6);
  const artifactContext = await currentArtifactContext();
  const messages = [
    ...recent,
    { role: 'user', content: `${question}\n\n${artifactContext}` },
  ];

  const result = await api('/api/v1/chat', { messages });
  appendChat('assistant', result.reply);
  state.chatHistory.push({ role: 'user', content: question }, { role: 'assistant', content: result.reply });
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
    return;
  }

  if (!codex.authenticated) {
    els.codexState.textContent = 'Codex: 未ログイン';
    els.codexLogin.hidden = false;
    updateActionStates();
    return;
  }

  const plan = codex.planType ? ` / ${codex.planType}` : '';
  const model = codex.model ? ` / ${codex.model}` : '';
  els.codexState.textContent = `Codex: 接続済み${plan}${model}`;
  els.codexLogin.hidden = true;
  updateActionStates();
}

async function refreshAppConfig() {
  const response = await fetch('/api/v1/config');
  if (!response.ok) throw new Error('Artifact Studio設定を取得できませんでした');
  const config = await response.json();
  state.appConfig = config;
  configureAdapters(config.demo || {});
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
      await new Promise(resolve => setTimeout(resolve, 2000));
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

modeler.on('commandStack.changed', scheduleSync);
modeler.on('selection.changed', event => {
  if (isBpmn()) renderSelected(event.newSelection?.[0] || null);
});

els.adapterSelect.addEventListener('change', () => {
  activateAdapter(els.adapterSelect.value).catch(error => setStatus(`adapter切替エラー: ${error.message}`));
});
els.generate.addEventListener('click', generateFromText);
els.validate.addEventListener('click', validateCurrent);
els.format.addEventListener('click', formatCurrent);
els.export.addEventListener('click', exportCurrent);
els.file.addEventListener('change', () => handleFile(els.file.files?.[0]));
els.mermaidSource.addEventListener('input', scheduleMermaidRender);
els.review.addEventListener('click', reviewCurrent);
els.chatForm.addEventListener('submit', handleChatSubmit);
els.codexLogin.addEventListener('click', loginCodex);

async function bootstrap() {
  state.workspace = readWorkspace();

  let config = null;
  try {
    config = await refreshAppConfig();
  } catch (error) {
    console.warn(error);
    configureAdapters({ defaultAdapter: 'bpmn', enabledAdapters: ['bpmn', 'mermaid'] });
    applyCodexStatus({ available: false, authenticated: false, error: error.message });
  }

  const configuredDefault = config?.demo?.defaultAdapter || 'bpmn';
  const storedAdapter = state.workspace.activeAdapter;
  const initialAdapter = state.enabledAdapters.includes(storedAdapter)
    ? storedAdapter
    : state.enabledAdapters.includes(configuredDefault)
      ? configuredDefault
      : state.enabledAdapters[0];

  const restored = await activateAdapter(initialAdapter, {
    restore: true,
    persistBeforeSwitch: false,
    announce: false,
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

bootstrap();
