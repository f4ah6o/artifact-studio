# Dagu Visual Workflow Editor

Status: closed
Closed: 2026-08-21
Created: 2026-08-21

## Goal

Add a visual workflow-definition editor to the existing Dagu adapter without replacing Dagu YAML as the canonical artifact.

The first useful slice should let users edit the common DAG structure visually while preserving the existing source-editor, validation, persistence, export, and `GraphProjection` architecture.

## Architectural rule

Dagu YAML remains the single source of truth.

```text
Visual editor
    ↕
YAML document model / structural edits
    ↓
canonical Dagu YAML
    ↓
dagu validate
```

Do not introduce an Artifact-Studio-specific workflow schema as a second canonical model.

`GraphProjection` remains a derived read-only projection contract. Do not mutate `GraphProjection` itself to become the workflow authority.

## MVP scope

### 1. Visual DAG editing

- render Dagu steps as nodes;
- add a step;
- delete a step;
- create a dependency by connecting two steps;
- remove a dependency;
- update the canonical YAML after every visual edit;
- refresh the visual graph when YAML is edited directly.

The visual direction of an edge is dependency -> dependent step. The YAML representation remains Dagu's `depends` field on the dependent step.

### 2. Step properties

Selecting a node exposes a small properties editor for the fields that are useful in most workflows:

- `id` / `name`;
- `run`;
- `depends` (readable/editable, even though links are the preferred interaction);
- `timeout_sec` when present;
- retry-related fields when present and safely editable without inventing semantics.

Do not attempt to expose every Dagu YAML field in the first implementation.

### 3. Source/visual synchronization

- YAML remains directly editable;
- source edits re-project into the visual editor;
- visual edits serialize back to YAML;
- unsupported fields are preserved when editing supported fields;
- comments and formatting should be preserved where practical, but semantic correctness and preservation of unsupported fields take priority over exact formatting retention;
- if a source cannot be safely structurally edited, disable visual mutation rather than silently rewriting or dropping data.

### 4. Validation

- existing `dagu validate` integration remains authoritative;
- visual edits do not imply semantic validity;
- validation findings continue to use the existing common findings UI;
- the visual editor must remain usable for structural editing when the Dagu binary is unavailable, matching the current adapter degradation behavior.

## UI direction

Use the existing As-Code Studio shell and Kumo migration direction.

Conceptually:

```text
┌────────────────────────────────────────────────────────────┐
│ DAG | YAML                                                 │
├──────────────────────────────────┬─────────────────────────┤
│                                  │ Step                    │
│  [fetch] ───> [transform]        │ id: transform           │
│                   │              │ run: python ...         │
│                   v              │ timeout: ...            │
│               [publish]          │ depends: fetch          │
│                                  │                         │
└──────────────────────────────────┴─────────────────────────┘
```

The exact layout may adapt to the current shell, but should provide:

- graph/editor view switch or split view;
- selectable nodes;
- a focused property panel;
- explicit add/delete/connect actions;
- no scheduler/runtime dashboard duplication.

## Implementation constraints

1. Keep Dagu adapter semantics inside the Dagu boundary.
2. Keep `GraphProjection` generic and adapter-independent.
3. Do not add Dagu-specific behavior to the generic graph renderer merely to support editing.
4. Prefer a Dagu-owned visual editor/controller that consumes the canonical YAML and existing projection data.
5. Parse/edit YAML through a YAML document/AST representation rather than lossy object stringify when possible.
6. Preserve unknown/unsupported step and workflow-level fields.
7. Keep official `dagu validate` as semantic authority.
8. Do not rebuild Dagu Web UI, runtime history, logs, workers, scheduler configuration, retry/stop controls, or orchestration APIs in this issue.

## Acceptance criteria

- [x] Dagu adapter offers a visual DAG editing view in addition to raw YAML.
- [x] Existing steps render as selectable nodes.
- [x] A user can add and delete a step visually.
- [x] A user can add and remove `depends` relationships visually.
- [x] Selecting a step exposes editable basic properties.
- [x] Visual mutations update canonical Dagu YAML.
- [x] Direct YAML edits update the visual representation.
- [x] Unsupported YAML fields survive supported visual edits.
- [x] Ambiguous/unsafe source shapes fail closed instead of losing content.
- [x] Existing `dagu validate` remains authoritative and works after visual edits.
- [x] Missing Dagu binary does not disable visual authoring.
- [x] Generic `GraphProjection` and renderer remain adapter-independent.
- [x] BPMN / Mermaid / OPA behavior does not regress.
- [x] tests and `vp check` pass.

## Out of scope

- full Dagu schema form coverage;
- runtime start/enqueue/status/history/retry/stop UI;
- scheduler dashboard;
- log viewer;
- credentials/secrets management;
- changing the canonical format away from Dagu YAML;
- making generic `GraphProjection` bidirectionally editable;
- arbitrary workflow layout persistence unless Dagu itself has a canonical field for it.


## Completion evidence

Implemented 2026-08-21.

- Added a Dagu-owned visual DAG renderer using ELK; generic `GraphProjection` remains read-only and adapter-independent.
- Added visual Step add/delete/select/connect controls and sidebar Step properties.
- Added YAML Document/AST editing via the `yaml` package so unknown workflow/step fields and comments are preserved where possible.
- Visual mutations update canonical Dagu YAML; direct YAML edits re-project into the visual graph.
- Existing `retry_policy` fields (`limit`, `interval_sec`, `backoff`, `max_interval_sec`) are editable when their shape is safe; unsupported retry shapes are preserved read-only.
- Ambiguous aliases, multi-document YAML, non-mapping steps, and unsafe dependency shapes fail closed for visual mutation.
- `dagu validate` remains the semantic authority; missing Dagu CLI still permits YAML and visual authoring.
- Tests cover empty-artifact creation, unknown-field/comment preservation, identity rename dependency rewrites, dependency add/remove, delete cleanup, retry policy editing, and fail-closed cases.

Validation:

- `vp check`: pass.
- `vp test --run`: 429 passed, 1 skipped.
- `vp build`: pass (existing large-chunk warning remains non-fatal; Dagu UI is lazy-loaded at adapter activation).
