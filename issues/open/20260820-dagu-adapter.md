# Dagu Workflow Adapter

## Goal

Add Dagu as the next structured workflow adapter after OPA.

Dagu workflow YAML is the canonical artifact. Artifact Studio should provide authoring, validation, graph projection, local persistence/export, and optional execution integration while keeping Dagu itself as the runtime authority.

## Why Dagu before n8n

Dagu fits Artifact Studio's adapter boundary unusually well:

- workflow definitions are portable declarative YAML rather than instance-owned editor state;
- DAG structure is explicit (`steps` + `depends`) and naturally projects into the generic `GraphProjection` contract;
- the runtime is a single local-first binary with no required external DB or broker;
- official CLI operations provide validation / dry-run / execution / status / history instead of requiring Artifact Studio to reproduce scheduler semantics;
- built-in MCP gives AI agents a runtime integration path without coupling Artifact Studio core to a Dagu instance API;
- workflow YAML can live beside source code and remain useful without Artifact Studio.

n8n remains a possible future adapter, but it is not the next implementation target.

## Canonical artifact

Initial adapter contract:

```ts
interface DaguArtifact {
  kind: 'text';
  source: string; // canonical Dagu YAML
}
```

Do not invent an Artifact-Studio-specific workflow schema. Parse only enough structure for generic projections and UI affordances; Dagu's own parser / validator remains authoritative for workflow semantics.

If Dagu features later require multiple referenced local artifacts, promote that need through the generic workspace content contract rather than introducing a Dagu-only persistence shape.

## Adapter capabilities

Initial capabilities:

- import `.yaml` / `.yml`
- edit canonical YAML
- deterministic text normalization where it is semantics-preserving
- validate using `dagu validate`
- graph preview through generic `GraphProjection`
- export canonical YAML
- optional `dagu dry` preview

Runtime capabilities can follow behind explicit actions:

- start
- enqueue
- status
- history
- retry / stop

Runtime actions must never become prerequisites for editing or validating a local artifact.

## Runtime authority

Artifact Studio must not reimplement Dagu scheduling or execution semantics.

Preferred authority:

```text
Dagu YAML
  -> dagu validate
  -> optional dagu dry
  -> optional dagu start / enqueue
  -> dagu status / history
```

Use fixed argv and explicit file paths. Do not assemble arbitrary shell command strings.

## Generic GraphProjection dogfood

Dagu is the second concrete consumer of the generic graph projection after OPA.

Projection:

```text
Dagu YAML
  -> parse structural step ids + depends
  -> GraphProjection
  -> generic renderer
```

At minimum:

```ts
interface GraphProjection {
  nodes: Array<{
    id: string;
    label: string;
    kind?: string;
    metadata?: Record<string, unknown>;
  }>;
  edges: Array<{
    from: string;
    to: string;
    kind?: string;
    metadata?: Record<string, unknown>;
  }>;
}
```

The projection is derived data, not a second canonical workflow model.

## UI

Initial UI should stay simple:

- source editor
- validation findings
- read-only DAG graph preview
- Validate
- Dry Run (when Dagu is available)
- Export

Do not rebuild Dagu's full Web UI, scheduler dashboard, logs UI, or run history UI in the first adapter.

## AI boundary

AI-generated or edited workflow YAML must pass Dagu validation before being accepted as valid.

Dagu's own MCP server is the preferred future integration for agent-driven runtime state changes. Artifact Studio should not create a competing orchestration control protocol.

## Core prerequisites before implementation

**Completed.** See `issues/closed/20260820-minimal-adapter-core-before-dagu.md` and implementation commit `0e0926561db9e0101fdfbe3159de1dbb7d930472`.

The available minimal core now provides:

1. generic `text` / `workspace` canonical content handling;
2. generic capability/action queries for validate / format / project plus adapter-owned actions;
3. adapter-independent `GraphProjection` normalization and validation;
4. a generic graph renderer with Mermaid as its current backend;
5. OPA dependency graph as the first migrated consumer.

Do **not** expand this into the full Architecture Graph / transformation system before Dagu. Dagu is the second real consumer that should prove or correct the minimal contract.

## Implementation order

1. Complete the minimal generic core prerequisites above.
2. Add Dagu registry entry and source editor flow.
3. Add YAML structural parser for step ids / dependencies only.
4. Produce `GraphProjection` and render the DAG read-only.
5. Add safe `dagu validate` backend action and common findings mapping.
6. Add optional `dagu dry`.
7. Persist / restore / export through the generic artifact content layer.
8. Regression tests for BPMN / Mermaid / OPA.
9. Live verification against a current Dagu binary.
10. Only then consider start/status/history integration.

## Acceptance criteria

- [ ] Dagu is available from the shared adapter selector.
- [ ] canonical YAML can be imported, edited, persisted, restored, and exported.
- [ ] `dagu validate` diagnostics are surfaced as common findings.
- [ ] step dependencies render via the generic `GraphProjection` renderer.
- [ ] OPA and Dagu both use the same graph projection contract and renderer.
- [ ] invalid or cyclic workflow structure is not treated as valid based only on Artifact Studio's lightweight parser; Dagu validation remains authoritative.
- [ ] Dagu binary absence degrades validation/runtime actions cleanly without breaking authoring.
- [ ] runtime invocation has no arbitrary command construction or path traversal.
- [ ] BPMN / Mermaid / OPA existing behavior and tests remain green.

## Out of scope for first implementation

- rebuilding Dagu Web UI
- scheduler configuration UI
- full log viewer
- distributed worker management
- credentials / secrets manager
- Dagu-compatible scheduler implementation in JavaScript
- generic Architecture Graph persistence
- bidirectional graph editing

