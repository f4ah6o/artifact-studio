import { createArtifactTransformController } from './artifact-transform-controller.js';
import { onArtifactRuntimeChange } from './artifact-runtime-registry.js';

const controller = createArtifactTransformController();
const els = {
  adapter: document.querySelector('#adapter-select'),
  actions: document.querySelector('#transform-actions'),
  lineage: document.querySelector('#artifact-lineage'),
  status: document.querySelector('#status'),
};

let renderGeneration = 0;
let renderTimer = null;

function muted(text) {
  const node = document.createElement('div');
  node.className = 'muted';
  node.textContent = text;
  return node;
}

function lineageRow(label, value) {
  const row = document.createElement('div');
  row.className = 'artifact-lineage-row';
  const key = document.createElement('span');
  key.className = 'muted';
  key.textContent = label;
  const detail = document.createElement('span');
  detail.textContent = value;
  row.append(key, detail);
  return row;
}

async function runTransform(transformId) {
  const adapterId = els.adapter.value;
  els.status.textContent = 'Artifact transform 実行中…';
  try {
    await controller.transformCurrent(adapterId, transformId);
    els.status.textContent = 'Artifact transform 完了';
  } catch (error) {
    els.status.textContent = `Artifact transform エラー: ${error.message}`;
  }
  await render();
}

async function regenerate() {
  const adapterId = els.adapter.value;
  els.status.textContent = 'Derived artifact を再生成中…';
  try {
    await controller.regenerateCurrent(adapterId);
    els.status.textContent = 'Derived artifact を再生成しました';
  } catch (error) {
    els.status.textContent = `再生成エラー: ${error.message}`;
  }
  await render();
}

async function render() {
  const generation = ++renderGeneration;
  const adapterId = els.adapter.value;
  els.actions.replaceChildren();
  els.lineage.replaceChildren();

  try {
    const state = await controller.currentState(adapterId);
    if (generation !== renderGeneration) return;

    if (!state.artifact) {
      els.actions.append(muted('Artifact を開くと利用可能な transform が表示されます。'));
      return;
    }

    if (state.transforms.length) {
      for (const transform of state.transforms) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button secondary transform-button';
        button.textContent = transform.label;
        button.addEventListener('click', () => void runTransform(transform.id));
        els.actions.append(button);
      }
    } else {
      els.actions.append(muted('この Artifact に利用可能な transform はありません。'));
    }

    if (!state.artifact.lineage) return;

    const transform = controller.registry.get(state.artifact.lineage.transform);
    const sourceLabels = state.sources.map((source) => source.adapterId || source.id).join(', ');
    els.lineage.append(
      lineageRow(
        'Derived from',
        sourceLabels || state.artifact.lineage.derivedFrom[0]?.artifactId || '',
      ),
      lineageRow('Transform', transform?.label || state.artifact.lineage.transform),
    );

    const freshness = document.createElement('div');
    freshness.className = `artifact-freshness ${state.status}`;
    freshness.textContent = `Status: ${state.status}`;
    els.lineage.append(freshness);

    if (state.status === 'stale') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button secondary transform-button';
      button.textContent = 'Regenerate';
      button.addEventListener('click', () => void regenerate());
      els.lineage.append(button);
    }
  } catch (error) {
    if (generation !== renderGeneration) return;
    els.lineage.append(muted(`Derived artifact status unavailable: ${error.message}`));
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => void render(), 0);
}

els.adapter.addEventListener('change', scheduleRender);
onArtifactRuntimeChange(scheduleRender);

void render();
