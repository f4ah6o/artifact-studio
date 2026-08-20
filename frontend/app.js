import BpmnModeler from 'bpmn-js/lib/Modeler';
import translations from 'bpmn-js-i18n/translations/ja.js';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';

const ARTIFACT_STORAGE_KEY = 'artifact-studio:last-artifact:v1';
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
  prompt: document.querySelector('#process-prompt'),
  generate: document.querySelector('#generate-button'),
  validate: document.querySelector('#validate-button'),
  format: document.querySelector('#format-button'),
  export: document.querySelector('#export-button'),
  file: document.querySelector('#file-input'),
  empty: document.querySelector('#empty-state'),
  status: document.querySelector('#status'),
  findings: document.querySelector('#findings'),
  findingCount: document.querySelector('#finding-count'),
  selected: document.querySelector('#selected-element'),
  review: document.querySelector('#review-button'),
  chatForm: document.querySelector('#chat-form'),
  chatInput: document.querySelector('#chat-input'),
  chatLog: document.querySelector('#chat-log'),
  codexState: document.querySelector('#codex-state'),
  codexLogin: document.querySelector('#codex-login-button'),
};

const state = {
  logicCore: null,
  validation: { errors: [], warnings: [] },
  diagramLoaded: false,
  suppressSync: false,
  syncTimer: null,
  chatHistory: [],
  llmAvailable: false,
  codex: null,
};

function setStatus(message) {
  els.status.textContent = message;
}

function persistDiagramXml(xml) {
  if (!xml) return;
  try {
    localStorage.setItem(ARTIFACT_STORAGE_KEY, JSON.stringify({
      adapter: 'bpmn',
      version: 1,
      updatedAt: new Date().toISOString(),
      source: xml,
    }));
  } catch (error) {
    console.warn('BPMNのブラウザ保存に失敗しました', error);
  }
}

function readPersistedDiagram() {
  try {
    let raw = localStorage.getItem(ARTIFACT_STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      if (stored?.adapter === 'bpmn' && stored?.version === 1 && typeof stored.source === 'string' && stored.source.trim()) {
        return { version: 1, savedAt: stored.updatedAt, xml: stored.source };
      }
    }

    // One-time migration from the BPMN-only MVP key.
    raw = localStorage.getItem(LEGACY_BPMN_STORAGE_KEY);
    if (!raw) return null;
    const legacy = JSON.parse(raw);
    if (legacy?.version !== 1 || typeof legacy.xml !== 'string' || !legacy.xml.trim()) return null;
    persistDiagramXml(legacy.xml);
    localStorage.removeItem(LEGACY_BPMN_STORAGE_KEY);
    return legacy;
  } catch (error) {
    console.warn('保存済みBPMNの読み込みに失敗しました', error);
    return null;
  }
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
  if (!state.diagramLoaded || typeof message !== 'string') return [];
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
    empty.textContent = state.diagramLoaded ? '構造上のfindingはありません。' : '検証結果はここに表示されます。';
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

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

async function fitDiagramToViewport() {
  // Wait until the workspace has its final dimensions before fitting.
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
    els.format.disabled = false;
    els.empty.classList.add('hidden');
    if (persist) persistDiagramXml(xml);
    await fitDiagramToViewport();
  } finally {
    state.suppressSync = false;
  }
}

async function syncLogicCore({ validate = true } = {}) {
  if (!state.diagramLoaded) return null;
  setStatus('BPMN → Logic-Core 同期中…');
  const { xml } = await modeler.saveXML({ format: true });
  // Persist the editable BPMN even if backend import/validation subsequently fails.
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
  if (state.suppressSync || !state.diagramLoaded) return;
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(() => {
    syncLogicCore().catch(error => setStatus(`同期エラー: ${error.message}`));
  }, 600);
}

async function generateFromText() {
  const userText = els.prompt.value.trim();
  if (!userText) return;

  els.generate.disabled = true;
  setStatus('CodexでBPMNを生成中…');
  try {
    const result = await api('/api/v1/orchestrate', { userText });
    if (!result.bpmnXml) throw new Error('BPMN XML was not returned');
    await importDiagram(result.bpmnXml);
    state.logicCore = result.logicCore;
    state.validation = result.validation || { errors: [], warnings: [] };
    renderFindings();
    setStatus('生成完了');
  } catch (error) {
    setStatus(`生成エラー: ${error.message}`);
  } finally {
    els.generate.disabled = !state.llmAvailable;
  }
}

async function validateCurrent() {
  try {
    await syncLogicCore({ validate: true });
  } catch (error) {
    setStatus(`検証エラー: ${error.message}`);
  }
}

async function formatCurrent() {
  if (!state.diagramLoaded) return;

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
    setStatus('整形完了');
  } catch (error) {
    setStatus(`整形エラー: ${error.message}`);
  } finally {
    els.format.disabled = !state.diagramLoaded;
  }
}

async function exportCurrent() {
  if (!state.diagramLoaded) return;
  try {
    const { xml } = await modeler.saveXML({ format: true });
    persistDiagramXml(xml);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'process.bpmn';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
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

async function askAi(question, { showUser = true } = {}) {
  if (!state.llmAvailable) throw new Error('Codexに接続されていません');
  if (state.diagramLoaded) await syncLogicCore({ validate: false });

  if (showUser) appendChat('user', question);

  const recent = state.chatHistory.slice(-6);
  const processContext = state.logicCore
    ? `\n\nCurrent Logic-Core JSON:\n${JSON.stringify(state.logicCore)}`
    : '';
  const messages = [
    ...recent,
    { role: 'user', content: `${question}${processContext}` },
  ];

  const result = await api('/api/v1/chat', { messages });
  appendChat('assistant', result.reply);
  state.chatHistory.push({ role: 'user', content: question }, { role: 'assistant', content: result.reply });
  return result;
}

async function reviewCurrent() {
  if (!state.diagramLoaded) return;
  els.review.disabled = true;
  setStatus('Codexレビュー中…');
  try {
    await askAi(
      'この既存BPMNをレビューしてください。構造上のlintでは検出できない、業務上もっとも重要な未定義事項を1つ質問してください。可能なら関係するBPMN element IDを明示してください。',
      { showUser: false },
    );
    setStatus('Codexレビュー完了');
  } catch (error) {
    setStatus(`Codexレビューエラー: ${error.message}`);
  } finally {
    els.review.disabled = !state.llmAvailable;
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
    const xml = await file.text();
    await importDiagram(xml);
    await syncLogicCore({ validate: true });
    setStatus(`${file.name} を読み込みました`);
  } catch (error) {
    setStatus(`読み込みエラー: ${error.message}`);
  }
}

async function restorePersistedDiagram() {
  const stored = readPersistedDiagram();
  if (!stored) return false;

  try {
    await importDiagram(stored.xml, { persist: false });
    try {
      await syncLogicCore({ validate: true });
    } catch (error) {
      // The diagram itself is still useful when the backend is temporarily unavailable.
      console.warn('復元したBPMNの同期に失敗しました', error);
    }
    return true;
  } catch (error) {
    console.warn('保存済みBPMNを復元できませんでした', error);
    return false;
  }
}

function applyCodexStatus(codex) {
  state.codex = codex || null;
  state.llmAvailable = Boolean(codex?.available && codex?.authenticated);
  els.generate.disabled = !state.llmAvailable;
  els.review.disabled = !state.llmAvailable;

  if (!codex?.available) {
    els.codexState.textContent = 'Codex app-server: 利用不可';
    els.codexLogin.hidden = true;
    return;
  }

  if (!codex.authenticated) {
    els.codexState.textContent = 'Codex: 未ログイン';
    els.codexLogin.hidden = false;
    return;
  }

  const plan = codex.planType ? ` / ${codex.planType}` : '';
  const model = codex.model ? ` / ${codex.model}` : '';
  els.codexState.textContent = `Codex: 接続済み${plan}${model}`;
  els.codexLogin.hidden = true;
}

async function refreshCodexStatus() {
  const response = await fetch('/api/v1/config');
  if (!response.ok) throw new Error('Codex設定を取得できませんでした');
  const config = await response.json();
  applyCodexStatus(config.codex);
  return state.llmAvailable;
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
      if (await refreshCodexStatus()) {
        setStatus('Codex接続完了');
        return;
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
modeler.on('selection.changed', event => renderSelected(event.newSelection?.[0] || null));

els.generate.addEventListener('click', generateFromText);
els.validate.addEventListener('click', validateCurrent);
els.format.addEventListener('click', formatCurrent);
els.export.addEventListener('click', exportCurrent);
els.file.addEventListener('change', () => handleFile(els.file.files?.[0]));
els.review.addEventListener('click', reviewCurrent);
els.chatForm.addEventListener('submit', handleChatSubmit);
els.codexLogin.addEventListener('click', loginCodex);

async function bootstrap() {
  const restored = await restorePersistedDiagram();

  try {
    await refreshCodexStatus();
    if (restored) {
      setStatus('前回のBPMNを復元しました');
    } else if (state.llmAvailable) {
      setStatus('準備完了 — Codex app-server');
    } else if (state.codex?.available) {
      setStatus('編集・検証は利用可能 / AI利用にはChatGPTログインが必要');
    } else {
      setStatus(`編集・検証は利用可能 / Codex app-serverを起動できません${state.codex?.error ? `: ${state.codex.error}` : ''}`);
    }
  } catch {
    els.generate.disabled = true;
    els.review.disabled = true;
    setStatus(restored ? '前回のBPMNを復元しました / Codex設定を取得できませんでした' : 'Codex設定を取得できませんでした');
  }
}

bootstrap();