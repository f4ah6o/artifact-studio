# Dagu 前の Minimal Adapter Core 抽出

Status: open
Date: 2026-08-20
Target: Artifact Studio
Blocks: `issues/open/20260820-dagu-adapter.md`
Related:
- `issues/open/20260820-artifact-composition-transformation-architecture.md`
- `issues/open/20260820-architecture-graph-semantic-model.md`
- `issues/closed/20260820-opa-adapter.md`

## Goal

Dagu adapter を追加する前に、OPA 実装で既に必要になった共通概念だけを generic core として抽出する。

Architecture Graph 全体や汎用 transformation framework を先行実装しない。今回固定するのは次の3点だけとする。

1. Canonical Artifact Content
2. Generic Capability / Action surface
3. GraphProjection

OPA を第1 consumer として migration し、Dagu が第2 consumer として同じ contract を利用できる状態を作る。

## 1. Canonical Artifact Content contract

core が扱う canonical content kind を明示する。

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

### Requirements

- `text` / `workspace` の normalize / validate / persistence を共通関数で扱う。
- adapter 固有の file extension、OPA workspace rule、Dagu YAML rule 等を content core に入れない。
- adapter registry の `contentKind` と canonical content contract を整合させる。
- browser persistence は adapter id + generic content を保存する。
- legacy persistence migration は維持する。
- BPMN / Mermaid / OPA の既存保存・復元を壊さない。

## 2. Generic Capability / Action surface

adapter が何をできるかを core から問い合わせられる generic contract を持つ。

最低限の共通 capability:

- `validate`
- `format`
- `project`

adapter 固有操作は action id として公開する。

例:

```text
OPA:
  evaluate
  test
  coverage
  dependencies

Dagu future:
  dry
  start
  enqueue
  status
  history
```

### Rules

- OPA の `eval/test/deps` を共通 interface の専用 method に昇格させない。
- Dagu の runtime action も core method に増やさない。
- `supportsCapability(adapter, capability)` / `supportsAction(adapter, action)` 相当の generic query を提供する。
- adapter descriptor は immutable / declarative に保つ。
- capability metadata は UI affordance に利用できるが、runtime authority の代替にはしない。

## 3. GraphProjection

adapter から導出される read-only graph の共通表現を固定する。

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

### Requirements

- projection は canonical artifact ではない。
- node / edge validation と deterministic normalization を generic core に置く。
- duplicate node id、dangling edge 等は generic projection error とする。
- OPA dependency graph をこの contract へ migration する。
- renderer は adapter を知らない。
- Mermaid は renderer/backend の一つであり canonical graph model にしない。
- OPA adapter / OPA backend は Mermaid source を直接生成しない。

## Scope boundary

今回やらないもの:

- Dagu adapter 本体
- Architecture Graph persistence
- artifact 間 semantic relationship model
- arbitrary adapter-to-adapter transformation
- lineage / stale tracking
- graph editor
- bidirectional projection editing
- runtime orchestration abstraction
- n8n adapter

これらは実 consumer が必要性を証明した後に別 issue で扱う。

## Implementation order

1. generic `ArtifactContent` normalize/validation API を抽出して既存 persistence test を拡張する。
2. adapter capability/action query API を導入し BPMN / Mermaid / OPA descriptor を migration する。
3. generic `GraphProjection` normalize/validation API を追加する。
4. generic graph renderer を追加し、Mermaid renderer をその backend として利用する。
5. OPA `dependencyProjection()` を generic GraphProjection contract に migration する。
6. OPA UI の dependency view を generic graph renderer 経由へ切り替える。
7. BPMN / Mermaid / OPA regression tests、Vite+ check/build を通す。
8. Dagu issue の core prerequisite を completion evidence に基づいて更新する。

## Acceptance criteria

- [ ] `ArtifactContent` の `text` / `workspace` contract が単一の generic API で normalize / persist / restore される。
- [ ] content core に OPA / BPMN / Mermaid / Dagu 固有分岐がない。
- [ ] adapter capabilities が generic query API で問い合わせ可能である。
- [ ] adapter 固有 runtime/action が core method として増殖していない。
- [ ] `GraphProjection` が adapter 非依存 module として存在する。
- [ ] malformed graph（duplicate node / dangling edge等）が deterministic に拒否される。
- [ ] OPA dependency graph が generic `GraphProjection` を返す。
- [ ] OPA dependency view が generic renderer を利用する。
- [ ] generic renderer は OPA を import / identify しない。
- [ ] Mermaid は graph の canonical representation になっていない。
- [ ] BPMN / Mermaid / OPA の既存behaviorが回帰しない。
- [ ] `vp check`, `vp test --run`, `vp build` が green。
- [ ] completion evidence を追記して `issues/closed/` に移せる。

## Completion evidence

未完了。実装完了時に commit / test / CI / concrete OPA migration evidence を記録する。
