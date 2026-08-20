# Minimal Adapter Core

[日本語](ADAPTER-CORE.ja.md)

Artifact Studio keeps the generic adapter core deliberately small. The core exists to support real adapters without replacing their canonical formats or runtime semantics.

## Scope

The current core has three shared contracts:

1. canonical artifact content;
2. adapter capability/action metadata;
3. read-only graph projection.

The implementation is shared by browser and server code under `src/core/`.

## Canonical artifact content

`src/core/artifact-content.js` defines the only generic content kinds:

```ts
type ArtifactContent =
  | { kind: 'text'; source: string }
  | {
      kind: 'workspace';
      files: Record<string, string>;
      entrypoints: string[];
      activeFile: string | null;
      inputFile: string | null;
    };
```

The core normalizes and validates the shape only. File extensions, parser rules, semantic validation, and runtime behavior remain adapter-owned.

`src/client/artifact-content.js` adds browser persistence and legacy migration on top of this pure contract.

## Capability and action metadata

`src/core/artifact-capabilities.js` separates small common capabilities from adapter-specific actions.

Common capabilities are currently:

- `validate`
- `format`
- `project`

Adapter-specific operations remain string action ids. For example, OPA exposes `evaluate`, `test`, `coverage`, and `dependencies`. Future Dagu operations such as `dry`, `start`, or `status` must remain actions rather than becoming new core methods.

Consumers query descriptors through `supportsCapability()`, `supportsAction()`, and `supportsView()`.

## GraphProjection

`src/core/graph-projection.js` defines an adapter-independent, derived, read-only graph:

```ts
interface GraphProjection {
  kind: 'graph';
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

Normalization rejects duplicate node ids and dangling edges and returns deterministic node/edge ordering.

A graph projection is not a canonical artifact. It is derived data that may be rendered through different backends.

## Rendering boundary

`src/client/graph-renderer.js` is the generic browser renderer. Its current backend is the existing Mermaid adapter.

The dependency direction is:

```text
adapter-derived structure
        ↓
GraphProjection
        ↓
generic graph renderer
        ↓
Mermaid renderer backend
```

OPA does not import or call Mermaid directly. `src/adapters/opa.js` returns a normalized `GraphProjection`; `src/client/opa-extension.js` passes it to the generic graph renderer.

Mermaid source is therefore a rendering intermediate, not the canonical graph model.

## Current consumers

- OPA: first `GraphProjection` consumer, for policy dependency graphs.
- Dagu: planned second consumer, for workflow DAGs.

The Dagu implementation should use these contracts first. If the second consumer exposes a real deficiency, evolve the shared contract from that evidence rather than building the larger Architecture Graph abstraction in advance.

## Explicit non-goals

This minimal core does not provide:

- Architecture Graph persistence;
- artifact-to-artifact transformations;
- lineage or stale tracking;
- graph editing;
- runtime orchestration semantics;
- adapter-specific parsers or validators.

Those remain separate concerns and require concrete multi-adapter evidence before promotion into core.
