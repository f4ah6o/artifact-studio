# ArtifactTransform Registry + Deterministic Transform + Lineage/Stale Proof

Status: closed
Date: 2026-08-21
Closed: 2026-08-21
Target: As-Code Studio
Parent: `issues/open/20260820-artifact-composition-transformation-architecture.md`
Depends on:
- `issues/closed/20260820-minimal-adapter-core-before-dagu.md`
- `issues/closed/20260820-dagu-graph-projection-consumer-proof.md`
- `issues/closed/20260820-dagu-adapter.md`

## Goal

Start Phase 3 of the Artifact Composition / Transformation Architecture with the smallest end-to-end proof that establishes a reusable transformation boundary without prematurely introducing workspace v2 or the Architecture Graph UI.

This issue must prove the following path:

```text
canonical source artifact
  -> ArtifactTransform contract
  -> transform registry
  -> one deterministic built-in transform
  -> independently exportable derived artifact
  -> lineage (derivedFrom + source revision)
  -> stale detection when the source revision changes
```

The result should make Transformation a first-class concept distinct from Projection and Reference while preserving adapter independence.

## Why this is the next unit

Phase 1 established the minimal generic contracts and GraphProjection boundary. Phase 2 proved that boundary with two materially different consumers, OPA and Dagu, using the same generic GraphProjection normalization and renderer.

The next architectural uncertainty is no longer GraphProjection reuse. It is whether As-Code Studio can create and track a derived canonical artifact through a generic transform registry without coupling source and destination adapters or requiring the future artifact-graph persistence model.

Do not implement the entire parent architecture issue in this slice.

## Scope

Implement only:

1. a minimal `ArtifactTransform` contract;
2. a registry for built-in transforms;
3. one small deterministic transform;
4. deterministic source revision/hash calculation where no external revision is supplied;
5. lineage recording on the derived artifact;
6. stale/current evaluation by comparing recorded source revision(s) with current source revision(s);
7. focused tests proving determinism, registry lookup, lineage, and stale transitions.

## ArtifactTransform contract

Keep the first contract deliberately small. Conceptually:

```ts
interface ArtifactTransform {
  id: string;
  label: string;
  from: string | string[];
  to: string;
  version: string;

  transform(
    artifact: Artifact,
    context: TransformContext,
  ): Promise<ArtifactContent> | ArtifactContent;
}
```

The exact runtime shape may follow existing JavaScript conventions rather than introducing TypeScript solely for this contract.

Required invariants:

- transform identity is stable;
- source adapter ids accepted by the transform are explicit;
- destination adapter id is explicit;
- transform version is explicit and recorded in lineage;
- transform execution does not mutate the source artifact;
- transform output is canonical `ArtifactContent` for the destination adapter;
- generic registry code does not import or special-case OPA, Dagu, or Mermaid.

## Registry

Add a generic transform registry with the minimum operations needed by this proof, such as:

- register/list transforms;
- resolve a transform by stable id;
- query transforms applicable to a source adapter;
- validate duplicate ids and malformed descriptors.

Do not add plugin discovery, dynamic package loading, filesystem scanning, or external process execution in this issue.

Built-in registration can remain explicit and static for now.

## Deterministic proof transform

Use one built-in transform that converts an artifact with the existing graph projection capability into a canonical Mermaid artifact.

Conceptual flow:

```text
OPA or Dagu canonical artifact
  -> existing adapter project capability
  -> GraphProjection
  -> existing deterministic GraphProjection -> Mermaid source conversion
  -> ArtifactContent { kind: 'text', source: ... }
  -> derived Mermaid artifact
```

Suggested transform identity:

```text
graph-projection-to-mermaid
```

This transform is useful for the proof because:

- OPA and Dagu already proved the same GraphProjection contract in Phase 2;
- `graphProjectionToMermaid()` is already deterministic for a normalized projection;
- Mermaid is an existing canonical artifact type, so the output is independently editable/exportable rather than merely an ephemeral view;
- the transform can depend on generic projection/capability resolution instead of source adapter imports;
- the proof does not invent a new domain model.

The implementation may initially register OPA and Dagu as accepted source adapter ids if the current capability registry cannot yet express "any adapter supporting project" without widening the core unnecessarily.

Do not move Mermaid rendering into the transform. The transform produces canonical Mermaid source; preview rendering remains the Mermaid adapter's responsibility.

## Artifact identity and source revision

This issue needs only enough identity/revision to make lineage and stale detection real.

Source identity must be stable within the proof. Reuse an existing artifact id if one exists; otherwise introduce the smallest generic identity field needed by the transform API without migrating workspace persistence.

Revision rules:

1. If a caller supplies a stable source revision, preserve it.
2. Otherwise compute a deterministic revision from canonical source content.
3. Revision calculation must be adapter-independent and deterministic for the same canonical content.
4. Do not require Git or a filesystem path.

A content hash is sufficient for the fallback revision.

## Lineage

The derived result must retain at least:

```json
{
  "derivedFrom": [
    {
      "artifactId": "source-artifact-id",
      "revision": "source-revision"
    }
  ],
  "transform": "graph-projection-to-mermaid",
  "transformVersion": "1"
}
```

`generatedAt` is optional for this proof and must not participate in deterministic transform output comparisons. If recorded, keep it separate from the canonical derived content and do not use it to determine freshness.

Lineage metadata is provenance, not a trust or validation guarantee.

## Stale detection

Implement only revision/hash comparison.

For every lineage source:

```text
recorded source revision == current source revision
  => current

recorded source revision != current source revision
  => stale
```

Required behavior:

- unchanged source remains current;
- changed source becomes stale;
- regenerating from the changed source records the new revision and returns to current;
- transform version mismatch may be reported as stale if the implementation can do so without widening this slice, but source revision comparison is the required proof;
- missing source identity/revision must fail explicitly rather than silently claiming current.

Do not add incremental dependency tracking.

## Projection vs Transformation boundary

Keep the distinction explicit:

```text
Projection
source artifact -> transient GraphProjection/view model

Transformation
source artifact -> canonical Mermaid ArtifactContent + lineage
```

The existing OPA/Dagu graph preview remains a Projection. Creating a Mermaid artifact from that projection is a Transformation because the result is a separately exportable canonical artifact.

Do not change GraphProjection itself to carry lineage or workspace relationship state.

## Acceptance criteria

- [x] a generic `ArtifactTransform` contract exists outside individual adapters.
- [x] a generic transform registry can resolve and list the proof transform.
- [x] duplicate/malformed transform registration is rejected deterministically.
- [x] generic transform registry code contains no OPA/Dagu/Mermaid special-case branches.
- [x] exactly one built-in deterministic transform is added for this proof.
- [x] the proof transform consumes the existing generic GraphProjection path rather than re-parsing OPA or Dagu itself.
- [x] the proof transform produces canonical Mermaid `ArtifactContent.kind = 'text'`.
- [x] identical source content/revision produces byte-identical canonical Mermaid content.
- [x] the derived result records `derivedFrom` source artifact id + revision.
- [x] the derived result records transform id + transform version.
- [x] source content can receive a deterministic fallback revision/hash without Git.
- [x] unchanged source is reported current.
- [x] changed source is reported stale.
- [x] regeneration from changed source records the new revision and returns to current.
- [x] OPA and Dagu GraphProjection behavior remains green.
- [x] BPMN / Mermaid existing behavior remains green.
- [x] local check/test/build gates are green.

## Tests / completion evidence

Completion evidence must record:

- implementation commit SHA(s);
- transform contract and registry file paths;
- proof transform id/version;
- source revision/hash algorithm and canonical input boundary;
- exact lineage shape produced by the proof;
- tests proving deterministic output;
- tests proving current -> stale -> regenerated/current transition;
- tests proving the transform reuses existing GraphProjection rather than source-specific parsing;
- OPA/Dagu/BPMN/Mermaid regression results;
- local check/test/build results;
- remote CI run/result when available;
- any generic contract correction required by this first transform consumer.

## Out of scope

Do not add in this issue:

- workspace persistence v2;
- Architecture Graph UI or read-only graph view;
- relationship persistence/navigation;
- regenerate UI;
- automatic background regeneration;
- arbitrary adapter-pair conversion;
- bidirectional transforms or inverse synchronization;
- manual-edit detached/fork state;
- plugin/external transform discovery;
- transform shell/process execution;
- network/filesystem capability policy framework;
- n8n or Bento transformation support;
- Matrix/Table/Timeline projection abstractions.

## Stop boundary

Once the registry, one deterministic transform, lineage, and stale proof are green, close this child issue with evidence before proceeding to regenerate UI, workspace v2, relationship persistence, or Architecture Graph work.


## Completion evidence

Completed 2026-08-21.

Implementation commit:

- `800b5b0329becc7024fd9ab5fe2c06eee0ad160f` — `feat: add artifact transform lineage proof`

Implemented generic boundary:

- `shared/artifact-transform.js` defines the runtime `ArtifactTransform` descriptor contract, `ArtifactTransformRegistry`, execution, revision, freshness, and regeneration APIs.
- The registry is adapter-blind: `register`, `get`, `list`, and `applicableTo` contain no OPA, Dagu, or Mermaid branches. Duplicate ids and malformed descriptors fail explicitly.
- `shared/builtin-artifact-transforms.js` contains exactly one built-in proof transform: `graph-projection-to-mermaid`, version `1`, accepting OPA/Dagu sources and producing canonical Mermaid `ArtifactContent.kind = 'text'`.
- The proof transform does not import or parse OPA/Dagu. It receives the existing generic projection path through `context.project(sourceArtifact)` and converts the returned `GraphProjection`.
- `graphProjectionToMermaid()` moved from the frontend renderer implementation into `shared/graph-projection-mermaid.js`; `frontend/graph-renderer.js` re-exports and reuses it, preserving the existing renderer entry point while making deterministic serialization reusable outside the UI. No `GraphProjection` schema correction was required.

Source revision/hash:

- Caller-supplied non-empty `artifact.revision` is preserved unchanged.
- Without an external revision, the source revision is `sha256:<hex>` over stable-key JSON of normalized canonical `ArtifactContent`.
- The hash boundary is adapter-independent and does not require Git, paths, workspace v2, or filesystem state.
- Workspace object keys are serialized stably; arrays retain canonical order.

Lineage shape produced by transform execution:

```json
{
  "derivedFrom": [
    {
      "artifactId": "source-artifact-id",
      "revision": "sha256:..."
    }
  ],
  "transform": "graph-projection-to-mermaid",
  "transformVersion": "1"
}
```

Lineage remains separate from canonical derived content. No generated timestamp participates in transform output or freshness.

Freshness/regeneration proof:

- `derivedArtifactStatus()` compares each recorded source revision against the current source revision and returns `current` or `stale`.
- Missing source identity fails explicitly instead of being treated as current.
- `regenerateDerivedArtifact()` re-executes the lineage transform for the same source artifact id, records the new revision, preserves the derived artifact id when present, and returns the regenerated artifact to `current`.
- Transform execution uses a normalized read-only source clone rather than exposing the caller's source object for mutation.

Focused proof tests:

- `scripts/artifact-transform.test.js`: 8 passed.
- Registry listing/resolution, malformed/duplicate registration, explicit revision preservation, deterministic SHA-256 fallback, lineage, identical deterministic Mermaid output, OPA/Dagu reuse of the same transform, missing projection failure, and `current -> stale -> regenerated/current` are covered.
- `scripts/graph-consumer-proof.test.js`: existing OPA/Dagu GraphProjection second-consumer proof remains green.

Local gates on the implementation revision:

- `vp check`: exit 0; 0 errors and 43 pre-existing warnings.
- `vp test --run`: 18 test files passed + 1 skipped; 406 tests passed + 1 skipped.
- `vp build`: success; existing chunk-size warning only.
- `git diff --check`: success.

Remote evidence:

- GitHub Actions run `32420078501`: success for implementation commit `800b5b0329becc7024fd9ab5fe2c06eee0ad160f`.
- Node 22 matrix job: success.
- Node 24 matrix job: success.

Stop boundary maintained:

- no workspace persistence v2;
- no relationship persistence/navigation;
- no regenerate UI or automatic background regeneration;
- no Architecture Graph UI;
- no plugin/external transform discovery;
- no arbitrary adapter-pair or bidirectional transform system.

The Phase 3 proof therefore establishes the requested chain end to end: `ArtifactTransform` contract -> generic registry -> deterministic GraphProjection-to-Mermaid transform -> source revision/hash -> derived lineage -> source-change stale detection -> regeneration back to current.
