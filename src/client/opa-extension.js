import { renderGraphProjection } from './graph-renderer.js';
import {
  currentArtifactRecord,
  persistArtifactContent,
  readArtifactContent,
  workspaceContent,
} from './artifact-content.js';
import {
  notifyArtifactRuntimeChange,
  registerArtifactRuntime,
} from './artifact-runtime-registry.js';
import { hostRuntime } from './host-runtime.js';

const els = {
  adapter: document.querySelector('#adapter-select'),
  pane: document.querySelector('#opa-pane'),
  mermaidPane: document.querySelector('#mermaid-pane'),
  canvas: document.querySelector('#canvas'),
  prompt: document.querySelector('#process-prompt'),
  generate: document.querySelector('#generate-button'),
  validate: document.querySelector('#validate-button'),
  format: document.querySelector('#format-button'),
  export: document.querySelector('#export-button'),
  file: document.querySelector('#file-input'),
  fileList: document.querySelector('#opa-file-list'),
  source: document.querySelector('#opa-source'),
  newFile: document.querySelector('#opa-new-file-name'),
  addFile: document.querySelector('#opa-add-file'),
  deleteFile: document.querySelector('#opa-delete-file'),
  inputFile: document.querySelector('#opa-input-file'),
  query: document.querySelector('#opa-query'),
  input: document.querySelector('#opa-input'),
  evaluate: document.querySelector('#opa-evaluate'),
  test: document.querySelector('#opa-test'),
  dependencies: document.querySelector('#opa-dependencies'),
  result: document.querySelector('#opa-result'),
  resultHeading: document.querySelector('#opa-result-heading'),
  status: document.querySelector('#status'),
  findings: document.querySelector('#findings'),
  findingCount: document.querySelector('#finding-count'),
  selectedHeading: document.querySelector('#selected-heading'),
  selected: document.querySelector('#selected-element'),
  review: document.querySelector('#review-button'),
};

let opaActive = false;
let persistTimer = null;
let workspace = restoreWorkspace();

function restoreWorkspace() {
  const content = readArtifactContent('opa');
  if (content?.kind === 'workspace') return workspaceContent(content);
  return workspaceContent({ files: {}, entrypoints: [], activeFile: null, inputFile: null });
}

function setStatus(message) {
  els.status.textContent = message;
}

function persistNow() {
  persistArtifactContent('opa', workspaceContent(workspace));
  notifyArtifactRuntimeChange();
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 120);
}

function hasFiles() {
  return Object.keys(workspace.files).length > 0;
}

function selectedPath() {
  return workspace.activeFile && Object.hasOwn(workspace.files, workspace.activeFile)
    ? workspace.activeFile
    : Object.keys(workspace.files)[0] || null;
}

function displaySelected() {
  if (!opaActive) return;
  els.selectedHeading.textContent = 'OPA workspace';
  els.selected.replaceChildren();
  const path = selectedPath();
  if (!path) {
    els.selected.className = 'muted';
    els.selected.textContent = 'ファイルがありません。';
    return;
  }
  els.selected.className = '';
  const name = document.createElement('div');
  name.className = 'selected-id';
  name.textContent = path;
  const detail = document.createElement('div');
  detail.className = 'muted';
  detail.textContent = `${workspace.files[path].split('\n').length} lines`;
  els.selected.append(name, detail);
}

function renderFileList() {
  const active = selectedPath();
  workspace.activeFile = active;
  els.fileList.replaceChildren();
  for (const path of Object.keys(workspace.files).sort()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `opa-file${path === active ? ' active' : ''}`;
    button.textContent = path;
    button.addEventListener('click', () => {
      workspace.activeFile = path;
      renderWorkspace();
      persistNow();
    });
    els.fileList.append(button);
  }
  if (!Object.keys(workspace.files).length) {
    const empty = document.createElement('div');
    empty.className = 'muted opa-file-empty';
    empty.textContent = 'Rego / JSON / YAML を追加してください。';
    els.fileList.append(empty);
  }
}

function renderInputFileOptions() {
  const current = workspace.inputFile;
  els.inputFile.replaceChildren();
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Workspace input: none';
  els.inputFile.append(none);
  for (const path of Object.keys(workspace.files).sort()) {
    if (!/\.(json|ya?ml)$/i.test(path)) continue;
    const option = document.createElement('option');
    option.value = path;
    option.textContent = `Workspace input: ${path}`;
    els.inputFile.append(option);
  }
  els.inputFile.value = current && Object.hasOwn(workspace.files, current) ? current : '';
  if (!els.inputFile.value) workspace.inputFile = null;
}

function renderWorkspace() {
  renderFileList();
  renderInputFileOptions();
  const path = selectedPath();
  els.source.disabled = !path;
  els.source.value = path ? workspace.files[path] : '';
  els.deleteFile.disabled = !path;
  displaySelected();
  syncActionStates();
}

function syncActionStates() {
  if (!opaActive) return;
  const loaded = hasFiles();
  els.validate.disabled = !loaded;
  els.format.disabled = !loaded;
  els.export.disabled = !loaded;
  els.evaluate.disabled = !loaded;
  els.test.disabled = !loaded;
  els.dependencies.disabled = !loaded;
  els.generate.disabled = true;
  els.review.disabled = true;
  els.prompt.disabled = true;
}

function syncUi() {
  const active = els.adapter.value === 'opa';
  opaActive = active;
  els.pane.classList.toggle('hidden', !active);
  if (active) {
    els.canvas.classList.add('hidden');
    els.mermaidPane.classList.add('hidden');
    renderWorkspace();
    els.prompt.disabled = true;
    els.generate.disabled = true;
    els.review.disabled = true;
    els.export.textContent = 'OPA workspaceを書き出す';
    setStatus(
      hasFiles()
        ? 'OPA workspace 準備完了'
        : 'OPA workspace — Rego / data / input を開いてください',
    );
  } else {
    els.prompt.disabled = false;
  }
}

function workspacePayload() {
  return workspaceContent(workspace);
}

async function api(action, body = {}) {
  return hostRuntime().artifactAction('opa', action, { workspace: workspacePayload(), ...body });
}

function renderFindings(findings = []) {
  els.findings.replaceChildren();
  els.findingCount.textContent = String(findings.length);
  if (!findings.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = hasFiles() ? '検出事項はありません。' : '検証結果はここに表示されます。';
    els.findings.append(empty);
    return;
  }
  for (const finding of findings) {
    const card = document.createElement('button');
    card.type = 'button';
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
    if (finding.file && Object.hasOwn(workspace.files, finding.file)) {
      card.addEventListener('click', () => {
        workspace.activeFile = finding.file;
        renderWorkspace();
        els.source.focus();
      });
    }
    els.findings.append(card);
  }
}

function showJson(title, value) {
  els.resultHeading.textContent = title;
  els.result.replaceChildren();
  const pre = document.createElement('pre');
  pre.className = 'opa-json-result';
  pre.textContent = JSON.stringify(value, null, 2);
  els.result.append(pre);
}

async function showGraph(graph, raw) {
  els.resultHeading.textContent = 'Dependencies';
  els.result.replaceChildren();
  if (!graph?.nodes?.length) return showJson('Dependencies', raw);
  try {
    const preview = document.createElement('div');
    preview.className = 'opa-graph-result';
    els.result.append(preview);
    await renderGraphProjection(graph, preview);
  } catch {
    showJson('Dependencies', raw);
  }
}

function parseInputEditor() {
  const source = els.input.value.trim();
  if (!source) return undefined;
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Input JSON: ${error.message}`);
  }
}

async function validate() {
  setStatus('OPA check 実行中…');
  const result = await api('check');
  renderFindings(result.findings || []);
  setStatus(result.ok ? 'OPA check 完了' : `OPA check: ${result.findings?.length || 0}件のエラー`);
}

async function format() {
  setStatus('OPA fmt 実行中…');
  const result = await api('format');
  workspace = workspaceContent(result.workspace);
  persistNow();
  renderWorkspace();
  await validate();
  setStatus('OPA workspace を整形しました');
}

async function evaluate() {
  const query = els.query.value.trim();
  if (!query) throw new Error('Query を入力してください');
  setStatus('OPA eval 実行中…');
  const result = await api('eval', { query, input: parseInputEditor(), explain: 'notes' });
  showJson('Decision / Explanation', result.evaluation);
  setStatus('OPA eval 完了');
}

async function runTests() {
  setStatus('OPA test 実行中…');
  const result = await api('test');
  showJson('Tests / Coverage', result.result);
  setStatus(result.result?.ok ? 'OPA test 完了' : 'OPA test: failing tests あり');
}

async function dependencies() {
  const query = els.query.value.trim();
  if (!query) throw new Error('Query を入力してください');
  setStatus('OPA deps 実行中…');
  const result = await api('deps', { query });
  await showGraph(result.result?.graph, result.result?.dependencies);
  setStatus('OPA dependency graph 完了');
}

function handleError(prefix, error) {
  if (error.code === 'OPA_UNAVAILABLE') {
    setStatus('OPA CLI が見つかりません。`opa` を PATH に追加してください。');
  } else {
    setStatus(`${prefix}: ${error.message}`);
  }
}

function addFile(path, source = '') {
  const safe = String(path || '')
    .trim()
    .replace(/^\.\//, '');
  if (!safe) throw new Error('ファイル名を入力してください（例: policy.rego）');
  if (
    safe.includes('\\') ||
    safe.startsWith('/') ||
    safe.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('安全な相対パスを入力してください');
  }
  if (!/\.(rego|json|ya?ml)$/i.test(safe))
    throw new Error('対応形式は .rego / .json / .yaml / .yml です');
  if (Object.hasOwn(workspace.files, safe)) throw new Error(`既に存在します: ${safe}`);
  workspace.files[safe] = source;
  workspace.activeFile = safe;
  renderWorkspace();
  persistNow();
}

async function importFiles(files) {
  const list = [...files];
  if (!list.length) return;
  if (list.length === 1 && list[0].name.toLowerCase().endsWith('.opa-workspace.json')) {
    const parsed = JSON.parse(await list[0].text());
    const imported =
      parsed.content?.kind === 'workspace' ? parsed.content : parsed.workspace || parsed;
    if (!imported?.files || typeof imported.files !== 'object')
      throw new Error('OPA workspace JSON に files がありません');
    workspace = workspaceContent(imported);
  } else {
    for (const file of list) {
      const path = (file.webkitRelativePath || file.name).replace(/^\.\//, '');
      if (!/\.(rego|json|ya?ml)$/i.test(path)) throw new Error(`未対応ファイル: ${path}`);
      if (
        path.includes('\\') ||
        path.startsWith('/') ||
        path.split('/').some((part) => !part || part === '.' || part === '..')
      )
        throw new Error(`安全でないパス: ${path}`);
      workspace.files[path] = await file.text();
      workspace.activeFile ||= path;
    }
  }
  persistNow();
  renderWorkspace();
  renderFindings([]);
  setStatus(`${list.length} file(s) を OPA workspace に読み込みました`);
}

function download(name, source, type) {
  const blob = new Blob([source], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportWorkspace() {
  persistNow();
  const paths = Object.keys(workspace.files);
  if (paths.length === 1 && paths[0].toLowerCase().endsWith('.rego')) {
    download(paths[0].split('/').at(-1), workspace.files[paths[0]], 'text/plain');
    return;
  }
  download(
    'policy.opa-workspace.json',
    `${JSON.stringify({ version: 1, adapter: 'opa', content: workspaceContent(workspace) }, null, 2)}\n`,
    'application/json',
  );
}

window.addEventListener('artifact-studio:flush-active-artifact', () => {
  if (!opaActive) return;
  clearTimeout(persistTimer);
  persistNow();
});

window.addEventListener('artifact-studio:active-artifact-changed', (event) => {
  syncUi();
  if (event.detail?.adapterId !== 'opa') return;
  clearTimeout(persistTimer);
  workspace = restoreWorkspace();
  if (opaActive) {
    renderWorkspace();
    renderFindings([]);
    setStatus(
      hasFiles()
        ? 'OPA workspace 準備完了'
        : 'OPA workspace — Rego / data / input を開いてください',
    );
  }
});

registerArtifactRuntime('opa', {
  currentArtifact() {
    if (!hasFiles()) return null;
    return currentArtifactRecord('opa', workspaceContent(workspace));
  },
  async project(artifact) {
    if (artifact?.content?.kind !== 'workspace') {
      throw new Error('OPA project requires workspace artifact content');
    }
    const query = els.query.value.trim() || artifact.content.entrypoints?.[0] || '';
    if (!query) {
      throw new Error('OPA transform requires a query or workspace entrypoint');
    }
    const data = await hostRuntime().artifactAction('opa', 'deps', {
      workspace: artifact.content,
      query,
    });
    if (!data.result?.graph) throw new Error('OPA project did not return GraphProjection');
    return data.result.graph;
  },
});

els.source.addEventListener('input', () => {
  const path = selectedPath();
  if (!opaActive || !path) return;
  workspace.files[path] = els.source.value;
  displaySelected();
  schedulePersist();
});

els.inputFile.addEventListener('change', () => {
  workspace.inputFile = els.inputFile.value || null;
  persistNow();
});

els.addFile.addEventListener('click', () => {
  try {
    addFile(els.newFile.value);
    els.newFile.value = '';
  } catch (error) {
    handleError('追加エラー', error);
  }
});

els.deleteFile.addEventListener('click', () => {
  const path = selectedPath();
  if (!path) return;
  delete workspace.files[path];
  if (workspace.inputFile === path) workspace.inputFile = null;
  workspace.activeFile = Object.keys(workspace.files).sort()[0] || null;
  persistNow();
  renderWorkspace();
});

for (const [element, action, label] of [
  [els.validate, validate, '検証エラー'],
  [els.format, format, '整形エラー'],
  [els.evaluate, evaluate, '評価エラー'],
  [els.test, runTests, 'テストエラー'],
  [els.dependencies, dependencies, '依存解析エラー'],
]) {
  element.addEventListener(
    'click',
    (event) => {
      if (!opaActive) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      action()
        .catch((error) => handleError(label, error))
        .finally(syncActionStates);
    },
    true,
  );
}

els.export.addEventListener(
  'click',
  (event) => {
    if (!opaActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    exportWorkspace();
  },
  true,
);

els.file.addEventListener(
  'change',
  (event) => {
    const files = [...(els.file.files || [])];
    const opaFile = files.some((file) => /\.rego$|\.opa-workspace\.json$/i.test(file.name));
    if (!opaActive && !opaFile) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!opaActive) {
      els.adapter.value = 'opa';
      els.adapter.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setTimeout(() => {
      syncUi();
      importFiles(files).catch((error) => handleError('読み込みエラー', error));
      els.file.value = '';
    }, 0);
  },
  true,
);

els.adapter.addEventListener(
  'change',
  () => {
    const leavingOpa = opaActive && els.adapter.value !== 'opa';
    if (leavingOpa) persistNow();
    setTimeout(() => {
      syncUi();
      if (leavingOpa) persistNow();
    }, 0);
  },
  true,
);

const adapterObserver = new MutationObserver(() => setTimeout(syncUi, 0));
adapterObserver.observe(els.adapter, { childList: true });
const codexObserver = new MutationObserver(() => {
  if (opaActive) syncActionStates();
});
codexObserver.observe(document.querySelector('#codex-state'), { childList: true, subtree: true });

renderWorkspace();
syncUi();
