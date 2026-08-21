# As-Code Studio — Agent Guide

As-Code Studio is a multi-adapter workbench. Do not assume the repository is BPMN-only.

Current implemented adapters:

- BPMN
- Mermaid
- OPA / Rego

The adapter registry is `src/client/artifact-adapters.js`. Generic artifact persistence is in `src/client/artifact-content.js`.

## Start here

Before changing code:

1. read `README.md` for current user-visible behavior;
2. read the relevant `docs/` document;
3. inspect `issues/open/` for active design constraints;
4. inspect related `issues/closed/` completion evidence before reimplementing an existing capability.

## Development

```bash
vp install
vp check
vp test --run
vp build
```

Run the local application with:

```bash
vp run dev
```

OPA is optional. OPA-specific actions require an `opa` executable on `PATH` or an absolute `OPA_BINARY`; the rest of As-Code Studio must continue to work when OPA is unavailable.

## Architectural rules

- Keep adapter-specific semantics inside adapter boundaries.
- Do not make one adapter import another adapter to reuse a visualization or transformation.
- Promote only proven shared concepts into generic core contracts.
- Preserve deterministic validation/layout where the codebase already provides it.
- Use official runtimes as semantic authorities when an adapter depends on them; do not casually reimplement their language/runtime semantics.
- Keep generated or derived views distinct from canonical artifacts.

For the current cross-adapter direction, read:

- `docs/ARTIFACT-ADAPTERS.md`
- `issues/open/20260820-artifact-composition-transformation-architecture.md`
- `issues/open/20260820-architecture-graph-semantic-model.md`

## Documentation rules

Follow `docs/DOCUMENTATION.md`.

In particular:

- README describes only the current codebase.
- Future design and implementation plans go in `docs/` or `issues/open/`.
- Completed issue work moves to `issues/closed/` with completion evidence.
- Maintained human-facing docs use English + Japanese pairs (`NAME.md` + `NAME.ja.md`).
- Upstream attribution and dependency-license information belongs in `THIRD-PARTY-NOTICES.md`, not duplicated throughout README/docs.

Historical design snapshots under `docs/superpowers/` are evidence, not the current architecture authority.
