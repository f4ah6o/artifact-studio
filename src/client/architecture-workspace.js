import { architectureGraphProjectionForWorkspace } from './architecture-graph-runtime.js';
import { getArtifactAdapter, supportsCapability } from './artifact-adapters.js';
import { semanticEntitiesForArtifact } from './artifact-runtime-registry.js';
import { artifactWorkspaceStore } from './artifact-workspace.js';
import { renderGraphProjection } from './graph-renderer.js';

let initialized = false;
let relationshipSequence = 0;

function createRelationshipId() {
  relationshipSequence += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  const suffix =
    uuid || `${Date.now()}-${relationshipSequence}-${Math.random().toString(36).slice(2)}`;
  return `relationship:${suffix}`;
}

function option(value, label) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

function refLabel(ref, artifacts) {
  const artifact = artifacts[ref.artifactId];
  const artifactLabel = artifact?.title || ref.artifactId;
  const entityLabel = ref.address || ref.entityId;
  return entityLabel ? `${artifactLabel} / ${entityLabel}` : artifactLabel;
}

export function initArchitectureWorkspace({
  ensureArtifactRuntime = async () => {},
  navigateSemanticRef = async () => false,
} = {}) {
  if (initialized) return;
  initialized = true;

  const store = artifactWorkspaceStore();
  const els = {
    button: document.querySelector('#architecture-button'),
    pane: document.querySelector('#architecture-pane'),
    form: document.querySelector('#architecture-relationship-form'),
    fromArtifact: document.querySelector('#architecture-from-artifact'),
    fromEntity: document.querySelector('#architecture-from-entity'),
    type: document.querySelector('#architecture-relationship-type'),
    toArtifact: document.querySelector('#architecture-to-artifact'),
    toEntity: document.querySelector('#architecture-to-entity'),
    add: document.querySelector('#architecture-add-relationship'),
    relationshipCount: document.querySelector('#architecture-relationship-count'),
    relationshipList: document.querySelector('#architecture-relationship-list'),
    refresh: document.querySelector('#architecture-refresh'),
    preview: document.querySelector('#architecture-preview'),
    findingCount: document.querySelector('#architecture-finding-count'),
    findings: document.querySelector('#architecture-findings'),
  };
  for (const [name, element] of Object.entries(els)) {
    if (!element) throw new Error(`Missing Architecture Graph element: ${name}`);
  }

  let active = false;
  let refreshGeneration = 0;

  function closeArchitectureView() {
    active = false;
    els.pane.classList.add('hidden');
    els.button.setAttribute('aria-pressed', 'false');
  }

  async function navigateGraphNode(node) {
    const metadata = node?.metadata || {};
    if (!metadata.artifactId || !store.get(metadata.artifactId)) return false;
    const ref = { artifactId: metadata.artifactId };
    if (metadata.entityId) ref.entityId = metadata.entityId;
    if (metadata.address) ref.address = metadata.address;
    closeArchitectureView();
    await navigateSemanticRef(ref);
    return true;
  }

  function setEmpty(target, message) {
    target.replaceChildren();
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = message;
    target.append(empty);
  }

  function populateArtifactSelect(select, preferredId = null) {
    const artifacts = store.list();
    const previous = select.value;
    select.replaceChildren();
    for (const artifact of artifacts) {
      select.append(option(artifact.id, `${artifact.title} · ${artifact.adapterId}`));
    }
    const next =
      [preferredId, previous, store.active()?.id, artifacts[0]?.id].find(
        (id) => id && artifacts.some((artifact) => artifact.id === id),
      ) || '';
    select.value = next;
    select.disabled = artifacts.length === 0;
  }

  async function populateEntitySelect(artifactSelect, entitySelect) {
    const artifact = store.get(artifactSelect.value);
    const previous = entitySelect.value;
    entitySelect.replaceChildren(option('', 'Artifact root'));
    if (!artifact) {
      entitySelect.disabled = true;
      return;
    }

    const adapter = getArtifactAdapter(artifact.adapterId);
    if (supportsCapability(adapter, 'semanticEntities')) {
      try {
        await ensureArtifactRuntime(artifact.adapterId);
        const entities = await semanticEntitiesForArtifact(artifact);
        for (const entity of entities) {
          const item = option(
            entity.id,
            `${entity.label || entity.address || entity.id} · ${entity.kind}`,
          );
          if (entity.address) item.dataset.address = entity.address;
          entitySelect.append(item);
        }
      } catch (error) {
        const unavailable = option('', `Semantic entities unavailable: ${error.message}`);
        unavailable.disabled = true;
        entitySelect.append(unavailable);
      }
    }
    if ([...entitySelect.options].some((item) => item.value === previous)) {
      entitySelect.value = previous;
    }
    entitySelect.disabled = false;
  }

  function selectedRef(artifactSelect, entitySelect) {
    const artifactId = artifactSelect.value;
    if (!artifactId) throw new Error('Artifactを選択してください');
    const value = { artifactId };
    const selected = entitySelect.selectedOptions[0];
    if (selected?.value) {
      value.entityId = selected.value;
      if (selected.dataset.address) value.address = selected.dataset.address;
    }
    return value;
  }

  function renderRelationshipList() {
    const relationships = store.listRelationships();
    els.relationshipCount.textContent = String(relationships.length);
    if (!relationships.length) {
      setEmpty(els.relationshipList, 'Relationshipはまだありません。');
      return;
    }
    els.relationshipList.replaceChildren();
    for (const relationship of relationships) {
      const row = document.createElement('div');
      row.className = 'architecture-relationship-row';
      const main = document.createElement('div');
      main.className = 'architecture-relationship-main';
      const type = document.createElement('div');
      type.className = 'architecture-relationship-type';
      type.textContent = relationship.type;
      const from = document.createElement('div');
      from.className = 'architecture-relationship-ref';
      from.textContent = `From: ${refLabel(relationship.from, store.workspace.artifacts)}`;
      const to = document.createElement('div');
      to.className = 'architecture-relationship-ref';
      to.textContent = `To: ${refLabel(relationship.to, store.workspace.artifacts)}`;
      main.append(type, from, to);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button secondary compact';
      remove.textContent = '削除';
      remove.addEventListener('click', () => store.removeRelationship(relationship.id));
      row.append(main, remove);
      els.relationshipList.append(row);
    }
  }

  function renderFindings(findings) {
    els.findingCount.textContent = String(findings.length);
    if (!findings.length) {
      setEmpty(els.findings, '検出事項はありません。');
      return;
    }
    els.findings.replaceChildren();
    for (const finding of findings) {
      const item = document.createElement('div');
      item.className = 'architecture-finding';
      const selector =
        finding.ref?.address || finding.ref?.entityId || finding.ref?.artifactId || '';
      item.textContent = `${finding.code} · ${finding.relationshipId} / ${finding.endpoint} · ${selector}`;
      els.findings.append(item);
    }
  }

  async function ensureSemanticRuntimes() {
    const adapterIds = new Set(
      store
        .list()
        .filter((artifact) => {
          const adapter = getArtifactAdapter(artifact.adapterId);
          return (
            supportsCapability(adapter, 'semanticEntities') ||
            supportsCapability(adapter, 'discoverRelationships')
          );
        })
        .map((artifact) => artifact.adapterId),
    );
    for (const adapterId of adapterIds) await ensureArtifactRuntime(adapterId);
  }

  async function renderArchitectureGraph(generation) {
    try {
      await ensureSemanticRuntimes();
      const result = await architectureGraphProjectionForWorkspace(store.workspace);
      if (generation !== refreshGeneration) return;
      renderFindings(result.findings);
      if (!result.graph.edges.length) {
        setEmpty(els.preview, 'Relationshipを追加または検出するとArchitecture Graphを表示します。');
        return;
      }
      await renderGraphProjection(result.graph, els.preview, {
        onNodeClick: (node) => void navigateGraphNode(node),
      });
    } catch (error) {
      if (generation !== refreshGeneration) return;
      setEmpty(els.preview, `Architecture Graph error: ${error.message}`);
    }
  }

  async function refresh({ preserveArtifacts = true } = {}) {
    if (!active) return;
    const generation = ++refreshGeneration;
    const previousFrom = preserveArtifacts ? els.fromArtifact.value : null;
    const previousTo = preserveArtifacts ? els.toArtifact.value : null;
    populateArtifactSelect(els.fromArtifact, previousFrom);
    const alternative = store.list().find((artifact) => artifact.id !== els.fromArtifact.value)?.id;
    populateArtifactSelect(els.toArtifact, previousTo || alternative || els.fromArtifact.value);
    await Promise.all([
      populateEntitySelect(els.fromArtifact, els.fromEntity),
      populateEntitySelect(els.toArtifact, els.toEntity),
    ]);
    if (generation !== refreshGeneration) return;
    renderRelationshipList();
    els.add.disabled = !els.fromArtifact.value || !els.toArtifact.value;
    await renderArchitectureGraph(generation);
  }

  async function toggle() {
    active = !active;
    els.pane.classList.toggle('hidden', !active);
    els.button.setAttribute('aria-pressed', String(active));
    if (active) await refresh({ preserveArtifacts: false });
  }

  els.button.setAttribute('aria-pressed', 'false');
  els.button.addEventListener('click', () => void toggle());
  els.refresh.addEventListener('click', () => void refresh());
  els.fromArtifact.addEventListener(
    'change',
    () => void populateEntitySelect(els.fromArtifact, els.fromEntity),
  );
  els.toArtifact.addEventListener(
    'change',
    () => void populateEntitySelect(els.toArtifact, els.toEntity),
  );
  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const type = els.type.value.trim();
      if (!type) throw new Error('Relationship typeを入力してください');
      store.upsertRelationship({
        id: createRelationshipId(),
        type,
        from: selectedRef(els.fromArtifact, els.fromEntity),
        to: selectedRef(els.toArtifact, els.toEntity),
        provenance: 'declared',
      });
    } catch (error) {
      setEmpty(els.preview, `Relationship error: ${error.message}`);
    }
  });

  store.onChange(() => {
    if (active) void refresh();
  });
}
