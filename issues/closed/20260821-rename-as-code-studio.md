# Rename Artifact Studio to As-Code Studio

Status: closed
Date: 2026-08-21

## Decision

Rename the public product and repository from **Artifact Studio** to **As-Code Studio**.

The product boundary is a local-first workbench for structured as-code artifacts rather than a generic business/transformation suite.

Current examples include:

- Process as Code — BPMN
- Policy as Code — OPA / Rego
- Workflow as Code — Dagu
- Data Model as Code — Bonita BDM
- Diagram as Code — Mermaid

DDT / Transformation Cockpit remains an upper-layer application that may use or embed As-Code Studio; it is not part of the As-Code Studio domain model.

## Compatibility

The rename must not discard existing browser workspace data or silently break existing server configuration.

- New browser persistence uses the `as-code-studio:*` namespace.
- Existing `artifact-studio:*` storage remains a migration input.
- New environment variables use the `AS_CODE_STUDIO_*` prefix.
- Existing `ARTIFACT_STUDIO_*` variables remain compatibility aliases, with the new names taking precedence.

Internal browser events and theme identifiers move to the new product namespace.

## Repository

- old: `f4ah6o/artifact-studio`
- new: `f4ah6o/as-code-studio`
- package name: `as-code-studio`

## Acceptance

- [x] Product-facing text uses As-Code Studio.
- [x] package metadata uses `as-code-studio`.
- [x] theme and internal event namespaces use `as-code-studio`.
- [x] new storage uses `as-code-studio:workspace:v2`.
- [x] old `artifact-studio:*` browser persistence is migrated without loss.
- [x] `AS_CODE_STUDIO_*` environment variables are canonical.
- [x] `ARTIFACT_STUDIO_*` remains a compatibility input.
- [x] GitHub repository renamed to `f4ah6o/as-code-studio`.
- [x] local `origin` updated to the new repository URL.
- [x] validation gates pass after rename.

## Verification

- `vp check`: passed (existing unrelated warnings only)
- `vp test --run`: 448 passed / 1 skipped
- `vp build`: passed
- `git diff --check`: passed
- GitHub repository: `f4ah6o/as-code-studio`
