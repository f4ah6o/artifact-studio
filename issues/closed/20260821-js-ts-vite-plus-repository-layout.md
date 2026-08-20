# JS/TS + Vite+ repository layout

## Problem

Artifact Studio inherited the original BPMN generator repository layout:

- the JavaScript package root was `scripts/` rather than the repository root;
- Vite+ configuration and dependency metadata lived under `scripts/`;
- production modules, tests, CLI/tooling, benchmarks, HTTP servers, and developer utilities were mixed in one directory;
- browser code lived in a separate top-level `frontend/` tree and generic cross-runtime contracts in another top-level `shared/` tree;
- development commands required `cd scripts`, which no longer represented Artifact Studio as a web application plus Node runtime.

## Goal

Reorganize the repository around one root JavaScript package and explicit source/tool/test boundaries without changing runtime behavior or adapter semantics.

## Result

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
vite.config.ts
index.html

src/
  client/       browser application and browser adapter integrations
  core/         adapter-independent contracts shared by browser/server
  adapters/     server-side adapter semantics (Mermaid / OPA / Dagu)
  bpmn/         BPMN pipeline and deterministic rendering/validation
  ai/           AI orchestration and provider/session modules
  server/       HTTP/MCP entry points and demo configuration

tools/
  bench/        benchmarks and comparison utilities
  robustness/   synthetic/robustness tooling
  dev.mjs       local multi-process development launcher
  build-skill.mjs
  evaluate-slm.js
  prepare-training-data.js

tests/
  adapters/
  ai/
  *.test.js
  fixtures/
  bench/
```

`index.html`, package metadata, lockfile, workspace metadata, and `vite.config.ts` now live at repository root. Vite+ commands are root-level commands.

The root Vite+ config explicitly excludes historical documentation, issue records, references, fixture data, and benchmark evidence from formatter/linter scope instead of formatting those files as an incidental consequence of moving the package root. Production/test/tooling code remains covered by `vp check`.

## Boundaries preserved

- No wholesale JavaScript-to-TypeScript conversion.
- No adapter contract or ArtifactTransform semantic redesign.
- No HTTP API contract change.
- No monorepo split.
- Historical documents under `docs/superpowers/` and prior completion records were not retroactively rewritten.

## Acceptance

- [x] Package manager metadata and `vite.config.ts` are at repository root.
- [x] Browser source is under `src/client/`; generic shared contracts are under `src/core/`.
- [x] Node production code is grouped under `src/{adapters,bpmn,ai,server}`.
- [x] Developer-only code is under `tools/`; executable tests are under `tests/`.
- [x] No tracked production JavaScript remains under the legacy top-level `frontend/`, `shared/`, or `scripts/` directories.
- [x] Root `vp check` passes.
- [x] Root `vp test --run` passes.
- [x] Root `vp build` passes.
- [x] BPMN generation smoke test passes from the repository root.
- [x] Current README / contributing / architecture docs and CI use the new paths and root-level commands.

## Completion evidence

Baseline before migration:

- `vp check` from legacy `scripts/`: exit 0, 43 existing warnings.
- `vp test --run`: 18 test files passed, 1 skipped; 406 tests passed, 1 skipped.
- `vp build`: succeeded.

After migration:

- `vp install` from repository root: succeeded with the existing lockfile.
- `vp check` from repository root: exit 0, 0 errors. Root/type-aware scope surfaces existing warnings but does not introduce a failing gate.
- `vp test --run`: 18 test files passed, 1 skipped; 406 tests passed, 1 skipped — identical functional test baseline.
- `vp build`: succeeded and writes the Vite output to root `dist/`.
- `node src/bpmn/pipeline.js tests/fixtures/simple-approval.json /tmp/artifact-studio-smoke`: succeeded and produced BPMN + SVG.
- `vp run build:skill`: succeeded and built a 44-file skill bundle from the new source paths.
- `vp run demo` with isolated test ports: API `/health` returned `status: ok` and the root Vite dev server served `index.html` successfully.
- `git diff --check`: clean.

The migration is therefore structural: the executable test baseline is unchanged while the package/tooling/source boundaries now match the current Artifact Studio architecture.
