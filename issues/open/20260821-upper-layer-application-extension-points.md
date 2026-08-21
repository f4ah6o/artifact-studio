# Upper-layer Application Extension Points

Status: open
Date: 2026-08-21
Target: As-Code Studio

Related:
- `issues/closed/20260821-ddt-transformation-cockpit-proposal.md`
- `issues/open/20260820-artifact-composition-transformation-architecture.md`
- `issues/open/20260820-architecture-graph-semantic-model.md`
- `issues/closed/20260821-artifact-workspace-lifecycle-host-boundary.md`

## Summary

As-Code Studio を BPMN / OPA / Dagu / Mermaid 等の structured artifact を扱う **public / generic local-first workbench** として維持しつつ、DDT Cockpit 等の上位 application が As-Code Studio の機能を再利用・embedできる extension point を整備する。

As-Code Studio 自体には Transformation / Fact / Decision / Concept 等の上位 domain model を持ち込まない。

```text
Upper-layer application
  ├─ domain/application model
  ├─ navigation / workflow
  └─ contextual artifact usage
          ↓
As-Code Studio
  ├─ Artifact / Workspace
  ├─ Adapter / View / Editor
  ├─ Relationship / SemanticRef
  ├─ Transform / Lineage
  └─ HostRuntime
          ↓
BPMN / OPA / Dagu / Mermaid / ...
```

## Boundary

### As-Code Studio owns

- Artifact identity / content / title / persistence
- ArtifactStore / Workspace
- adapter registry
- adapter-owned editor / view / validation capabilities
- ArtifactRelationship / SemanticRef generic primitives
- transform / lineage / stale / regenerate primitives
- generic relationship traversal / projection
- generic repository / external-resource references
- generic provenance / revision references
- proposal / diff / review / apply primitives
- HostRuntime / local process / filesystem boundary
- embeddable editor/view integration contract

### Upper-layer application owns

Examples include DDT / Transformation Cockpit, but As-Code Studio must not depend on these concepts.

- domain-specific work context and lifecycle
- Transformation
- Fact / Question / Decision / Evidence
- Concept / Term / Context domain semantics
- domain-specific impact analysis
- verification / observation workflow
- governance / approval / waiver semantics
- organization-specific repository registry and policy

## Design principles

### 1. No upper-domain dependency from As-Code Studio

As-Code Studio core and adapters must not import or require an upper-layer domain model.

A user must be able to use As-Code Studio directly without creating a Transformation, Project governance object, Decision, or similar domain object.

### 2. Artifact editors must be reusable contextually

An upper-layer application should be able to open an existing Artifact in the appropriate editor/view without coupling to adapter-specific DOM implementation.

Conceptual API:

```text
openArtifact(artifactId)
openArtifactView(artifactId, view?)
getArtifactCapabilities(artifactId)
```

Exact API shape is to be designed incrementally from the current runtime registry.

### 3. References rather than copied bodies

Upper-layer applications should refer to Artifact / repository / external resource identities rather than duplicate canonical bodies into their own model.

### 4. Proposal before mutation

AI or upper-layer automation should be able to propose a change without immediately mutating canonical Artifact content.

Generic flow:

```text
proposal
  → diff / impact review
  → apply
  → validation
```

This must remain domain-neutral. As-Code Studio does not decide who is authorized to approve a proposal.

### 5. Repository references are generic

As-Code Studio may represent a repository/resource reference and revision, but must not become an organization-specific repository registry.

Minimum candidate fields:

- kind
- stable reference / URI
- repository-relative path or artifact-local address where applicable
- revision / commit / digest where applicable
- optional display label

### 6. Relationship traversal remains semantic infrastructure

ArtifactRelationship / SemanticRef can support generic traversal and projections.

As-Code Studio may answer questions such as:

- what artifacts reference this artifact/entity?
- what derived artifacts depend on this source?
- what relationship paths connect two semantic refs?

Whether such a path means a DDT impact, governance violation, or business dependency belongs to the upper layer.

## Candidate implementation slices

### A. Embeddable Artifact View API

- generic `openArtifact` / selection API
- view/capability discovery
- adapter-owned rendering remains encapsulated
- no direct DOM knowledge required by upper layer

### B. Generic Resource Reference

- repository / file / external-resource reference contract
- optional pinned revision
- no private repository catalog in public core

### C. Proposal / Diff / Apply

- proposed Artifact content/change object
- current vs proposed diff surface
- explicit apply operation
- validation after apply
- provenance linking proposal to source/tool where available

### D. Relationship Traversal API

- traverse confirmed ArtifactRelationship edges
- preserve open-vocabulary relationship types
- return paths without assigning upper-domain meaning

### E. Upper-layer Host Integration

- allow a host/application shell to provide navigation/context around As-Code Studio
- keep ArtifactStore and HostRuntime injectable
- avoid hard-coding a specific desktop framework or DDT Cockpit

## Non-goals

This issue does NOT implement:

- DDT Transformation lifecycle
- Fact / Question / Decision models
- Concept / Term / Context domain model
- DDT-specific Impact Analysis
- Verification / Observation workflow
- Policy approval workflow
- Waiver semantics
- organization / identity master
- company-specific repository registry
- Electron or Tauri packaging
- a generic enterprise architecture repository

## Acceptance criteria

- [x] As-Code Studio README/product boundary remains a generic structured-artifact workbench.
- [ ] Upper-layer application code can open/reuse an Artifact editor/view through a generic runtime API rather than adapter-specific DOM knowledge.
- [ ] A generic external/repository resource reference can be represented with optional revision provenance.
- [ ] A proposed Artifact change can exist separately from canonical content and requires explicit apply.
- [ ] Generic relationship traversal can return semantic paths without DDT-specific interpretation.
- [x] No Transformation / Fact / Decision / Concept domain dependency is introduced into As-Code Studio core.
- [x] Existing direct Artifact workflows remain first-class and all existing tests remain green.

## Direction

Implement bottom-up. Do not build all extension points speculatively.

Prefer extracting a generic primitive only when an actual upper-layer use case or a second internal consumer proves the boundary.
