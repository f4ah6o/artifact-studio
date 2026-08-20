# Minimal Adapter Core

[English](ADAPTER-CORE.md)

Artifact Studio の generic adapter core は意図的に小さく保つ。core の役割は実 adapter を支えることであり、各 artifact の canonical format や runtime semantics を置き換えることではない。

## Scope

現在の core は次の3つの shared contract だけを持つ。

1. canonical artifact content
2. adapter capability / action metadata
3. read-only GraphProjection

browser / server の双方から使う実装は `shared/` に置く。

## Canonical artifact content

`shared/artifact-content.js` は generic content kind を次の2種類に限定する。

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

core が扱うのは shape の normalize / validation までとする。file extension、parser rule、semantic validation、runtime behavior は各 adapter が所有する。

`frontend/artifact-content.js` は、このpure contractの上にbrowser persistenceとlegacy migrationを追加する。

## Capability / Action metadata

`shared/artifact-capabilities.js` は少数の共通 capability と adapter 固有 action を分離する。

現在の共通 capability:

- `validate`
- `format`
- `project`

adapter固有操作はstring action idのまま保持する。OPAでは `evaluate`, `test`, `coverage`, `dependencies` を公開する。将来のDaguにおける `dry`, `start`, `status` 等もcore methodへ昇格させずactionとして扱う。

consumerは `supportsCapability()`, `supportsAction()`, `supportsView()` でdescriptorを問い合わせる。

## GraphProjection

`shared/graph-projection.js` は adapter 非依存の derived / read-only graph を定義する。

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

normalize時にduplicate node idとdangling edgeを拒否し、node / edgeの順序をdeterministicにする。

GraphProjectionはcanonical artifactではない。別rendererへ渡せるderived dataである。

## Rendering boundary

`frontend/graph-renderer.js` がgeneric browser rendererであり、現在のbackendとして既存Mermaid adapterを利用する。

依存方向は次の通り。

```text
adapter-derived structure
        ↓
GraphProjection
        ↓
generic graph renderer
        ↓
Mermaid renderer backend
```

OPAはMermaidを直接import / callしない。`scripts/artifacts/opa.js` がnormalized `GraphProjection` を返し、`frontend/opa-extension.js` がgeneric graph rendererへ渡す。

したがってMermaid sourceはrendering intermediateであり、canonical graph modelではない。

## Current consumers

- OPA: policy dependency graphで使う第1 `GraphProjection` consumer
- Dagu: workflow DAGで使う予定の第2 consumer

Dagu実装ではまずこのcontractをそのまま利用する。第2 consumerで実際の不足が判明した場合だけshared contractを拡張し、Architecture Graph全体を先行実装しない。

## Explicit non-goals

このminimal coreは以下を提供しない。

- Architecture Graph persistence
- artifact間transformation
- lineage / stale tracking
- graph editing
- runtime orchestration semantics
- adapter固有parser / validator

これらは別concernとして扱い、複数adapterで具体的な必要性が証明されてからcoreへの昇格を検討する。
