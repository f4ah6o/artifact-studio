# Dagu GraphProjection Second-Consumer Proof

Status: closed
Date: 2026-08-20
Target: Artifact Studio
Parent: `issues/open/20260820-dagu-adapter.md`
Depends on: `issues/closed/20260820-minimal-adapter-core-before-dagu.md`
Related:
- `issues/open/20260820-artifact-composition-transformation-architecture.md`
- `issues/open/20260820-architecture-graph-semantic-model.md`

## Goal

Implement the first useful Dagu adapter slice specifically to prove whether the minimal adapter core extracted from OPA is genuinely reusable by a second structured artifact.

Dagu is the second concrete `GraphProjection` consumer after OPA. The objective is not merely to render a Dagu DAG. The implementation must produce evidence that the current generic contracts are sufficient across two materially different adapters, and must correct the generic core only when Dagu demonstrates a real cross-adapter need.

The proof covers three previously extracted contracts:

1. canonical `ArtifactContent` (`text` / `workspace`);
2. generic capability/action discovery;
3. adapter-independent `GraphProjection` + generic renderer.

## Proof question

The implementation should answer this concretely:

> Can OPA dependencies and Dagu workflow dependencies use the same canonical content, capability/action, graph projection, and renderer contracts without adapter-specific branches leaking into the generic core?

A successful result means Dagu can be implemented as a consumer of the existing contracts, with only evidence-driven generic corrections. A failed abstraction must be corrected rather than papered over with Dagu-specific exceptions in shared modules.

## Scope

Implement only the Dagu slice required for second-consumer proof:

- register Dagu in the shared adapter registry;
- author/import/export canonical Dagu YAML as `ArtifactContent.kind = 'text'`;
- persist and restore through the generic artifact content layer;
- structurally parse step ids and dependencies only;
- project that structure into the existing generic `GraphProjection`;
- render the DAG through the same generic graph renderer used by OPA;
- expose validation through the generic capability/action surface;
- invoke `dagu validate` safely when a Dagu binary is available;
- map Dagu validation failures to common findings;
- degrade cleanly when Dagu is unavailable;
- keep BPMN, Mermaid, and OPA behavior green.

Optional only after the proof above is complete:

- `dagu dry` as an adapter-owned action.

## Core invariants to prove

### ArtifactContent

- Dagu YAML uses the generic `text` content kind.
- No Dagu-specific persistence shape is added.
- No Dagu branches are added to `shared/artifact-content.js`.
- If Dagu exposes a real need for `workspace`, that need must be promoted generically and supported by another consumer or explicitly justified as cross-adapter capability.

### Capability / Action surface

- generic capability queries are sufficient to expose validation/project affordances;
- Dagu-specific operations remain action ids rather than new core methods;
- runtime authority remains Dagu itself, not Artifact Studio;
- adding Dagu must not require OPA-specific or Dagu-specific UI branching in generic capability queries.

### GraphProjection

- Dagu returns the same normalized `GraphProjection` contract as OPA;
- the generic renderer does not import, identify, or special-case Dagu;
- node ids are stable and deterministic for a given workflow;
- dependency edges are deterministic;
- duplicate nodes and dangling edges continue to be rejected by generic projection validation;
- Dagu-specific metadata is optional metadata, not a schema fork;
- Mermaid remains a rendering backend, not the canonical graph model.

## Dagu authority boundary

Artifact Studio may parse enough YAML to derive a read-only graph, but must not claim semantic validity from that parser alone.

Authoritative flow:

```text
Dagu YAML
  -> lightweight structural projection
  -> GraphProjection (read-only preview)

Dagu YAML
  -> dagu validate
  -> authoritative validity / findings
```

A workflow with a structurally renderable DAG but invalid Dagu semantics must remain invalid.

Do not implement Dagu scheduling semantics, cycle semantics, expression evaluation, command execution semantics, or scheduler state in JavaScript.

## Safe process boundary

When invoking Dagu:

- use fixed argv, never shell command construction;
- use explicit controlled paths;
- do not interpolate arbitrary flags from artifact source;
- isolate temporary files;
- surface missing binary as an unavailable capability/action, not as an authoring failure;
- clean up temporary artifacts deterministically.

## Implementation order

1. Add Dagu adapter descriptor using the existing generic content/capability contract.
2. Add minimal YAML structural parsing for workflow step ids and dependency references.
3. Convert parsed structure directly to generic `GraphProjection`.
4. Render through the existing generic graph renderer without Dagu-specific renderer code.
5. Add Dagu text authoring/import/export/persistence through generic `ArtifactContent`.
6. Add safe `dagu validate` backend action and common findings mapping.
7. Add missing-binary behavior and failure-path tests.
8. Add cross-consumer contract tests proving OPA and Dagu both normalize/render through the same generic APIs.
9. Run BPMN / Mermaid / OPA regressions plus Vite+ check/test/build.
10. Live-verify against a current Dagu binary when available.
11. Record any generic core corrections, why Dagu proved them necessary, and which second consumer now exercises them.
12. Add completion evidence and move this issue to `issues/closed/`.

## Acceptance criteria

- [x] Dagu is registered without adding a Dagu branch to generic content handling.
- [x] Dagu YAML imports, edits, persists, restores, and exports via generic `ArtifactContent.kind = 'text'`.
- [x] Dagu step dependencies produce a valid generic `GraphProjection`.
- [x] Dagu and OPA use the same graph normalization contract.
- [x] Dagu and OPA use the same generic graph renderer entry point.
- [x] generic graph renderer contains no Dagu or OPA special-case.
- [x] malformed projection remains rejected by generic validation.
- [x] Dagu-specific operations remain adapter-owned action ids.
- [x] `dagu validate` is authoritative for semantic validity.
- [x] missing Dagu binary does not prevent editing/persisting/exporting YAML.
- [x] Dagu process invocation uses fixed argv and controlled paths only.
- [x] no arbitrary shell command construction is introduced.
- [x] BPMN / Mermaid / OPA behavior remains green.
- [x] `vp check`, `vp test --run`, and `vp build` are green.
- [x] remote CI is green on supported Node versions.
- [x] completion evidence explicitly states whether the minimal core survived unchanged or what evidence-driven generic corrections were required.

## Success evidence to record

Completion evidence must include:

- implementation commit SHA(s);
- exact generic core files reused by both OPA and Dagu;
- cross-consumer test names/results;
- local `vp check` / `vp test --run` / `vp build` results;
- remote CI run id/result;
- live Dagu version and validation result if a binary was available;
- any generic core changes made during the proof, with a concrete Dagu requirement explaining each one;
- confirmation that no Dagu-specific branch was added to generic content or graph renderer modules.

## Stop boundary

Do not expand this proof into:

- full Dagu Web UI replacement;
- scheduler dashboard or run history UI;
- start/stop/retry orchestration unless needed by a later issue;
- generic Architecture Graph persistence;
- generic artifact transformation framework;
- bidirectional graph editing;
- n8n implementation;
- adapter-specific graph renderer forks.

Once this proof is green, close it before expanding the Dagu adapter further.

## Completion evidence

Completed 2026-08-20.

Implementation commit:

- `747658d8bc79d262dd4568712d894c7793eb0581` — `feat: add Dagu GraphProjection consumer proof`

Second-consumer result:

- The minimal adapter core survived unchanged. No generic core correction was required by Dagu.
- `shared/artifact-content.js` remains adapter-blind; Dagu persists canonical YAML through `frontend/artifact-content.js` as `ArtifactContent.kind = 'text'`.
- `shared/artifact-capabilities.js` is reused by the Dagu registry descriptor for generic `validate` / `project` discovery. No Dagu runtime operation was promoted into a core method.
- `shared/graph-projection.js` is reused directly by both `scripts/artifacts/opa.js::dependencyProjection()` and `scripts/artifacts/dagu.js::daguGraphProjection()`.
- `frontend/graph-renderer.js` is reused by both `frontend/opa-extension.js` and `frontend/dagu-extension.js`. It contains no OPA or Dagu special-case.
- Dagu dependency parsing is intentionally structural only: step `id` / `name` plus explicit `depends`. Cycles, chain scheduling, expressions, router semantics, and runtime validity are not reimplemented in JavaScript.
- Unresolved dependency references are passed into the generic projection contract and rejected by generic dangling-edge validation.
- Dagu CLI invocation uses fixed argv (`dagu validate <controlled-temp-path>`), `shell: false`, isolated temporary files/config paths, bounded output/timeout, and deterministic cleanup.
- Missing Dagu binary is exposed as runtime validation unavailable while YAML editing, generic persistence/export, and graph projection remain available.

Cross-consumer proof tests:

- `scripts/graph-consumer-proof.test.js` — `registers Dagu as generic text with validate/project capabilities`: passed.
- `scripts/graph-consumer-proof.test.js` — `OPA and Dagu normalize to the same graph contract and render through one generic entry point`: passed.
- `scripts/artifacts/dagu.test.js`: 8 passed, including scalar/array/block dependencies, name/id aliases, anonymous structural nodes, cycle non-judgment, generic dangling-edge rejection, findings mapping, and missing-binary behavior.
- `scripts/dagu-http-server.test.js`: 4 passed, including projection without a Dagu binary and runtime capability degradation.
- `scripts/artifact-content.test.js`: Dagu generic text round-trip passed alongside OPA workspace persistence.

Local gates on the implementation revision:

- `vp check`: exit 0, 0 errors, 44 pre-existing warnings.
- `vp test --run`: 16 test files passed + 1 skipped; 384 tests passed + 1 skipped.
- `vp build`: success; only the existing chunk-size warning remains.
- `git diff --check`: success.
- `dagu` binary: not present on the implementation host, so no live Dagu version/positive CLI validation result was available. The unavailable path was exercised by automated tests instead.

Remote evidence:

- GitHub Actions run `32378807064`: success for implementation commit `747658d8bc79d262dd4568712d894c7793eb0581`.
- Node 22 matrix job: success, including Vite+ setup, check, test, build, and BPMN/SVG smoke.
- Node 24 matrix job: success, including Vite+ setup, check, test, build, and BPMN/SVG smoke.

The proof therefore answers the core question positively: OPA dependencies and Dagu workflow dependencies reuse the same canonical content, capability/action, GraphProjection, and generic renderer contracts without adapter-specific branches leaking into the generic core.
