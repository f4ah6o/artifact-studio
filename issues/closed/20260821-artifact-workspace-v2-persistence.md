# Artifact Workspace v2 Persistence

Status: closed
Date: 2026-08-21
Target: As-Code Studio
Parent: `issues/open/20260820-artifact-composition-transformation-architecture.md`
Depends on: `issues/closed/20260821-artifact-transform-regenerate-ui.md`

## Goal

Replace the current latest-per-adapter persistence model with a backward-compatible workspace that can retain multiple canonical artifacts with stable identity, active artifact selection, derived artifact lineage, and reload-safe freshness checks.

Minimum model:

```ts
interface ArtifactWorkspace {
  version: 2;
  activeArtifactId: string | null;
  artifacts: Record<string, ArtifactNode>;
}

interface ArtifactNode {
  id: string;
  adapterId: string;
  content: ArtifactContent;
  revision?: string;
  lineage?: ArtifactLineage;
}
```

Existing non-artifact shell metadata such as AI session state may remain as a backward-compatible extension to the envelope.

## Scope

1. Add a generic workspace v2 persistence/store boundary with stable artifact ids.
2. Persist multiple artifacts, including multiple artifacts using the same adapter.
3. Persist and restore `activeArtifactId`.
4. Persist canonical content, optional revision, and lineage per artifact.
5. Migrate existing `artifact-studio:workspace:v1`, `artifact-studio:artifact-content:v1`, last-artifact, and legacy BPMN data without data loss.
6. Keep old persistence keys as read-only migration inputs; new writes use workspace v2.
7. Add a generic artifact selector and explicit New Artifact action while retaining the adapter selector as artifact-type/capability selection.
8. Make source and derived artifacts independently selectable after reload.
9. Ensure lineage source ids resolve after reload so existing `derivedArtifactStatus()` can still report current/stale.
10. Keep Git entirely optional; browser persistence remains sufficient.

## Acceptance

- [ ] workspace v2 persists more than one artifact.
- [ ] two artifacts with the same adapter retain distinct stable ids and content.
- [ ] active artifact selection persists across reload.
- [ ] derived artifact content + lineage persist across reload.
- [ ] source/derived identity survives reload and supports freshness evaluation.
- [ ] legacy workspace/content persistence migrates without discarding existing BPMN/Mermaid/OPA/Dagu content.
- [ ] UI can select existing artifacts and create a new artifact without adapter-specific selector routing.
- [ ] existing transform UI continues to operate on the selected artifact.
- [ ] no Git dependency is introduced.
- [ ] existing BPMN / Mermaid / OPA / Dagu behavior remains green.
- [ ] focused tests, full relevant tests, `vp check`, `vp build`, and `git diff --check` are green.

## Non-goals

- ArtifactRelationship / SemanticRef;
- semantic entity graph;
- field-level lineage;
- Architecture Graph visualization;
- CRDT;
- event sourcing;
- detached/manual-edit semantics;
- Git-backed persistence;
- changing adapter canonical models.

## Stop boundary

Close once multiple stable artifact identities, active selection, migration, derived lineage persistence, and reload-safe freshness are proven. Do not introduce relationship taxonomy, SemanticRef, Business Data Model, ER projection, or Architecture Graph UI in this child.

## Completion evidence

Completed 2026-08-21.

### Implementation

- Added `src/client/artifact-workspace.js` with the v2 envelope, stable artifact ids, `activeArtifactId`, multiple same-adapter artifacts, lineage/revision persistence, and a shared storage-backed workspace store.
- New writes use `artifact-studio:workspace:v2`. Existing `artifact-studio:artifact-content:v1`, `artifact-studio:workspace:v1`, `artifact-studio:last-artifact:v1`, and legacy BPMN persistence are read only as migration inputs.
- Migration prefers the richer generic Phase A artifact record when both old shell and generic persistence contain the same adapter, preserving derived lineage.
- `artifact-content.js` now acts as a compatibility facade over workspace v2 rather than a latest-per-adapter storage backend.
- Added a generic Artifact selector and `New Artifact` action. Adapter selection remains a capability/type selector; artifact selection is identity-based and supports multiple artifacts using the same adapter.
- BPMN/Mermaid restoration and OPA/Dagu extension state now follow the selected artifact. A generic flush/active-artifact event boundary prevents delayed editor persistence from being redirected to a newly selected same-adapter artifact.
- Runtime lineage source lookup falls back to workspace identity, so a derived artifact can resolve a non-active source artifact after reload.
- No Git persistence/backend was introduced.

### Focused proof

`tests/artifact-workspace.test.js` proves:

- two same-adapter artifacts retain distinct stable ids/content;
- active artifact identity survives store reload;
- Phase A generic persistence + shell v1 + legacy BPMN migration preserve richer canonical records and AI session metadata;
- source/derived ids + lineage survive reload;
- unchanged reloaded source => `current`; changed reloaded source => `stale`.

`tests/artifact-content.test.js` proves the compatibility facade still preserves canonical workspace/text content, derived identity, and lineage.

### Validation

- focused workspace/content/transform tests: 3 files, 7 tests passed.
- full `vp test --run`: 21 files passed, 413 tests passed, 1 skipped.
- `vp check`: 0 errors, 46 warnings — identical warning count to the Phase A baseline.
- `vp build`: green; existing chunk-size warning only.
- `git diff --check`: green.

### Stop boundary

No ArtifactRelationship/SemanticRef contract, semantic entity graph, Business Data Model, ER projection, CRDT/event sourcing, Git persistence, or Architecture Graph UI was introduced here.
