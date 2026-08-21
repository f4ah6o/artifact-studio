# ArtifactTransform Regenerate UI

Status: closed
Date: 2026-08-21
Target: As-Code Studio
Parent: `issues/open/20260820-artifact-composition-transformation-architecture.md`
Depends on: `issues/closed/20260821-artifact-transform-registry-lineage-stale-proof.md`

## Goal

Expose the already-complete generic `ArtifactTransform` capability through the As-Code Studio workflow without adding adapter-to-adapter imports, transform-specific frontend routing, workspace v2, or Architecture Graph UI.

Required user flow:

```text
source artifact
  -> applicable transforms from generic registry
  -> Transform
  -> derived artifact
  -> current

source changed
  -> derived artifact = stale
  -> explicit Regenerate
  -> derived artifact = current
```

## Scope

1. Add a small generic frontend artifact runtime boundary so transform UI can obtain the current canonical artifact, invoke an adapter-owned projection capability, and open a canonical destination artifact without branching on transform ids.
2. Render applicable transforms from the existing built-in `ArtifactTransformRegistry` for the active artifact.
3. Execute the existing `graph-projection-to-mermaid` transform from the UI.
4. Preserve derived artifact id, canonical content, lineage, and source revision metadata while this v1/latest-per-adapter persistence model remains in use.
5. Make the derived Mermaid artifact selectable through the existing artifact selector and exportable through existing Mermaid export behavior.
6. Show minimal lineage/freshness UI for derived artifacts: source, transform label/id, and `current` / `stale`.
7. Mark a derived artifact stale after its recorded source revision changes.
8. Offer explicit `Regenerate` only for stale derived artifacts and return it to `current` with updated lineage revision after regeneration.

## Acceptance

- [ ] applicable transforms come from the generic transform registry.
- [ ] frontend transform UI contains no OPA/Dagu/Mermaid transform-id routing.
- [ ] existing `graph-projection-to-mermaid` executes from the UI.
- [ ] derived Mermaid content opens as a separately selectable artifact and remains exportable.
- [ ] lineage is retained while switching source/destination adapters.
- [ ] unchanged source reports `current`.
- [ ] changed source reports `stale`.
- [ ] stale derived artifact exposes explicit `Regenerate`.
- [ ] regenerate records the new source revision and returns the derived artifact to `current`.
- [ ] no automatic/background regeneration is introduced.
- [ ] existing OPA / Dagu / BPMN / Mermaid behavior remains green.
- [ ] focused tests, full relevant tests, `vp check`, `vp build`, and `git diff --check` are green.

## Non-goals

- workspace persistence v2 or multiple same-adapter artifact identities;
- manual-edit `detached` state;
- automatic/background regeneration;
- Architecture Graph UI;
- relationship / SemanticRef persistence;
- arbitrary shell/process transforms;
- plugin transform discovery;
- new transforms or new adapters;
- bidirectional synchronization.

## Stop boundary

Close this issue once the existing transform proof is usable from the Studio UI with lineage + current/stale + explicit regenerate behavior and existing regressions are green. Do not continue into workspace v2, semantic relationships, Business Data Model, or Architecture Graph in this change.

## Completion evidence

Completed 2026-08-21.

### Implementation

- Added `src/client/artifact-runtime-registry.js` as the minimal frontend boundary for generic current-artifact, project, and open-artifact capabilities. It contains no adapter or transform routing.
- Added `src/client/artifact-transform-controller.js` and `src/client/artifact-transform-ui.js`. Applicable actions come from `ArtifactTransformRegistry.applicableTo()`; execution and regeneration call the existing core `executeArtifactTransform()` / `regenerateDerivedArtifact()` APIs.
- Registered adapter-owned runtime capabilities in the existing BPMN/Mermaid shell and OPA/Dagu extensions. Projection remains owned by the source adapter; opening canonical transformed content remains owned by the destination adapter.
- Added a minimal generic Transform panel. It shows registry-provided transform labels plus derived source, transform, and `current` / `stale`; stale artifacts expose explicit `Regenerate`. No background regeneration was added.
- Extended the existing generic artifact-content v1 envelope only enough to retain derived artifact identity + lineage while switching adapters/reloading. This deliberately does **not** implement workspace v2 or multiple same-adapter artifacts.
- Existing GraphProjection -> Mermaid is now runnable through this generic UI path. The produced Mermaid content is opened via the existing Mermaid artifact selector path and remains exportable through existing Mermaid export behavior.

### Architecture evidence

- Generic transform frontend files contain no `opa`, `dagu`, `mermaid`, or `graph-projection-to-mermaid` routing tokens.
- `tests/artifact-transform-controller.test.js` proves: registry discovery -> transform -> independently opened Mermaid derived artifact -> `current` -> source mutation -> `stale` -> explicit regenerate -> updated lineage revision -> `current`.
- `tests/artifact-runtime-registry.test.js` proves generic current/project/open capability dispatch without adapter-specific routing.
- `tests/artifact-content.test.js` proves derived id + lineage survive content persistence in the current v1 bridge.

### Validation

Baseline before implementation:

- `vp test --run`: 406 passed, 1 skipped.
- `vp check`: 0 errors, 46 pre-existing warnings.
- `vp build`: green, existing chunk-size warning only.

Completion gates:

- focused transform/content/runtime tests: 4 files, 14 tests passed.
- full `vp test --run`: 20 files passed, 410 tests passed, 1 skipped.
- `vp check`: 0 errors, 46 warnings — same warning count as baseline, no new warning class introduced by this change.
- `vp build`: green; existing chunk-size warning only.
- `git diff --check`: green.

### Stop boundary

Workspace persistence v2, detached/manual-edit semantics, SemanticRef/relationships, Business Data Model, ER projection, and Architecture Graph UI remain deferred to their later child phases.
