# Artifact Relationship / SemanticRef Core

Status: closed
Date: 2026-08-21
Target: Artifact Studio
Parent: `issues/open/20260820-architecture-graph-semantic-model.md`
Depends on: `issues/closed/20260821-artifact-workspace-v2-persistence.md`

## Goal

Add the smallest generic logical relationship contract required to connect future artifact types to Architecture Graph without introducing a closed taxonomy, universal semantic model, or graph UI.

Minimum contracts:

```ts
interface SemanticRef {
  artifactId: string;
  entityId?: string;
  address?: string;
}

interface ArtifactRelationship {
  id: string;
  type: string;
  from: SemanticRef;
  to: SemanticRef;
  provenance: 'declared' | 'discovered' | 'generated';
}
```

## Scope

1. Normalize/validate artifact-level `SemanticRef` plus optional semantic entity/address fields.
2. Normalize/validate `ArtifactRelationship` with open-vocabulary `type`.
3. Restrict only `provenance` to the three contract values; do not close relationship types.
4. Persist relationships in workspace v2 without changing artifact identity semantics.
5. Validate referential integrity against workspace artifact ids.
6. Validate entity refs when a consumer supplies an entity resolver; otherwise report entity resolution as explicitly unresolved rather than silently accepting it.
7. Preserve logical refs independent of adapter-specific URLs or file/display labels.

## Acceptance

- [ ] artifact-level refs are supported.
- [ ] optional `entityId` and logical `address` are supported.
- [ ] relationship `type` is an open non-empty string; unknown custom types round-trip.
- [ ] declared/discovered/generated provenance round-trips.
- [ ] workspace v2 persists relationships across reload.
- [ ] missing source/target artifact is reported explicitly.
- [ ] missing semantic entity is reported explicitly when an entity resolver exists.
- [ ] semantic entity without a resolver is reported explicitly as unresolved.
- [ ] no adapter-specific URL contract is introduced.
- [ ] no Architecture Graph UI is introduced.
- [ ] focused tests, full tests, `vp check`, `vp build`, and `git diff --check` are green.

## Non-goals

- fixed `uses` / `reads` / `writes` / `validated-by` enum;
- semantic entity model for a particular adapter;
- Business Data Model;
- ER projection;
- Architecture Graph visualization;
- field-level lineage;
- bidirectional synchronization.

## Stop boundary

Close once the generic relationship/ref contract, persistence, and referential validation are proven. Do not add Business Data Model or graph UI in this child.

## Completion evidence

Completed 2026-08-21.

### Implementation

- Added `src/core/artifact-relationship.js` with minimal `SemanticRef` and `ArtifactRelationship` contracts.
- `type` remains an open non-empty string; only provenance is constrained to `declared | discovered | generated`.
- `SemanticRef` keeps logical `artifactId` plus optional `entityId` and logical `address`; no adapter URL or filename identity is required.
- Added generic referential validation with distinct `missing_artifact`, `missing_entity`, and `entity_unresolved` findings. Entity validation is consumer-supplied through a resolver rather than a universal semantic model.
- Extended workspace v2 with a relationship record and store CRUD while retaining `version: 2` backward compatibility.
- Unknown/custom relationship types persist and reload unchanged.

### Focused proof

- `tests/artifact-relationship.test.js`: open vocabulary, provenance constraints, logical semantic refs, missing artifact/entity/unresolved reporting.
- `tests/artifact-workspace.test.js`: custom relationship persistence across workspace reload.

### Validation

- focused relationship/workspace tests: 2 files, 7 tests passed.
- full `vp test --run`: 22 files passed, 417 tests passed, 1 skipped.
- `vp check`: 0 errors, 46 warnings — unchanged baseline warning count.
- `vp build`: green; existing chunk-size warning only.
- `git diff --check`: green.

### Stop boundary

No Business Data Model, ER projection, Architecture Graph UI, field-level lineage, closed relationship taxonomy, or bidirectional synchronization was added.
