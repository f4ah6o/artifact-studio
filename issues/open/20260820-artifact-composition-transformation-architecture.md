# Artifact Composition / Transformation Architecture

Status: open
Date: 2026-08-20
Target: Artifact Studio

## Current progress

As of 2026-08-21, Phase 2 is complete and Phase 3 is now active:

- Phase 1: the minimal adapter/core contracts, adapter-independent `GraphProjection`, and generic renderer boundary are established.
- Phase 2: OPA is the first GraphProjection consumer and Dagu is the second; the Dagu proof completed without adapter-specific leakage or a generic-core correction.
- Phase 3 is now the active phase, but it will be implemented incrementally rather than by completing this parent issue in one change.

Completed first Phase 3 child:

- `issues/closed/20260821-artifact-transform-registry-lineage-stale-proof.md` — `ArtifactTransform` contract + registry + one deterministic GraphProjection-to-Mermaid transform + source revision lineage + current/stale/regenerate proof.

Workspace persistence v2, relationship persistence/navigation, regenerate UI, and Architecture Graph UI remain deferred beyond this proof.

## Goal

Artifact Studio の各 adapter は独立性を保ったまま、Artifact 間の連動を第一級の概念として扱えるようにする。

現在の Artifact Studio は BPMN / Mermaid / OPA / n8n / Bento などの artifact type を adapter 単位で扱う方向にあるが、今後は単なる「複数フォーマット対応エディタ」ではなく、**構造化 Artifact 同士を変換・参照・派生・可視化できる Workbench** へ拡張する。

```text
Artifact A
   │
   ├─ project
   ├─ transform
   └─ reference
        │
        ▼
Artifact B / View
```

## Principle

Adapter 同士を直接依存させない。

例えば OPA adapter が Mermaid adapter を import したり、n8n adapter が BPMN adapter を直接呼んだりする構造は避ける。

```text
Bad

OPA adapter ──imports──> Mermaid adapter
BPMN adapter ─imports──> Mermaid adapter
n8n adapter ──imports──> Mermaid adapter
```

代わりに、Artifact Studio 本体に generic な Composition / Transformation / Projection 層を置く。

```text
OPA adapter ───┐
BPMN adapter ──┼──> GraphProjection ──> renderer
n8n adapter ───┘
```

各 adapter は自分の canonical artifact と意味論だけを理解する。

## Three kinds of relationships

Artifact 間の連動は少なくとも以下の3種類を区別する。

### 1. Projection

同じ Artifact の意味内容を別の view model へ投影する。

元 Artifact の canonical source は変化しない。

例:

```text
OPA bundle
   ↓ project
Dependency Graph
```

```text
Policy model
   ↓ project
Role Matrix
```

```text
BPMN
   ↓ project
GraphProjection
```

Projection は保存可能な別 Artifact を必須とはしない。

### 2. Transformation

Artifact A から別の canonical Artifact B を生成する。

例:

```text
Policy YAML
   ↓ compile
OPA bundle
```

```text
Workflow DSL
   ↓ transform
BPMN
```

生成された Artifact B は独立 artifact として保存・export可能である。

### 3. Link / Reference

Artifact A が Artifact B を参照する。

変換やコピーを伴わない。

例:

```text
BPMN task
  └─ decision-policy ──> OPA entrypoint
```

```text
n8n workflow
  └─ implements ──> BPMN process
```

```text
Bento document
  └─ visualizes ──> another artifact
```

Reference は adapter 固有 URL を直接埋め込むのではなく、Artifact Studio が解決可能な logical artifact reference を優先する。

## Artifact graph

Workspace を artifact の単なる集合ではなく、関係を持つ graph として扱えるようにする。

```text
Workspace
│
├─ order-approval.bpmn
├─ approval.rego
├─ deployment.json
└─ architecture.mmd

order-approval.bpmn
      ├─ uses ──────────> approval.rego
      └─ implemented-by -> deployment.json
```

概念モデル:

```ts
interface ArtifactNode {
  id: string;
  adapterId: string;
  revision?: string;
  content: ArtifactContent;
}

interface ArtifactRelationship {
  id: string;
  fromArtifactId: string;
  toArtifactId: string;
  kind: string;
  metadata?: Record<string, unknown>;
}

interface ArtifactWorkspace {
  artifacts: Record<string, ArtifactNode>;
  relationships: ArtifactRelationship[];
}
```

`kind` は initially open vocabulary とし、`uses`, `implements`, `derived-from`, `visualizes`, `compiled-from` などを扱えるようにする。

特定ドメイン固有の relationship vocabulary を core へハードコードしない。

## Transformation contract

Adapter contract とは別に generic transform contract を導入する。

概念例:

```ts
interface ArtifactTransform<From = unknown, To = unknown> {
  id: string;
  label: string;
  from: string | string[];
  to: string;

  transform(
    artifact: Artifact<From>,
    context: TransformContext,
  ): Promise<Artifact<To>>;
}
```

Transform は source adapter / destination adapter の内部実装を直接 import しなくてもよい構造を目指す。

Artifact registry / capability registry を介して canonical model を受け渡す。

## Projection contract

Projection は renderer と分離する。

```ts
interface ArtifactProjection<Model = unknown, ViewModel = unknown> {
  id: string;
  label: string;
  accepts: string | string[];
  outputKind: string;

  project(artifact: Artifact<Model>): Promise<ViewModel>;
}
```

初期の generic projection model 候補:

```ts
type Projection =
  | GraphProjection
  | MatrixProjection
  | TableProjection
  | TimelineProjection;
```

ただし、最初から全形式を抽象化しない。

実需要のある GraphProjection から始め、Matrix / Table / Timeline は具体的 adapter で2つ以上の再利用例が出てから共通化する。

## GraphProjection

最初に共通化する projection として directed graph を扱う。

概念例:

```ts
interface GraphProjection {
  nodes: Array<{
    id: string;
    label: string;
    kind?: string;
    metadata?: Record<string, unknown>;
  }>;

  edges: Array<{
    id?: string;
    from: string;
    to: string;
    label?: string;
    kind?: string;
    metadata?: Record<string, unknown>;
  }>;
}
```

利用例:

- OPA rule dependency graph
- BPMN topology preview
- n8n node graph preview
- generic dependency graph

GraphProjection は Mermaid source ではない。

```text
Adapter
  ↓
GraphProjection
  ↓
Renderer
  ├─ Mermaid
  ├─ SVG
  └─ future canvas renderer
```

これにより adapter と Mermaid を直接結合しない。

## Lineage

Transformation で生成された artifact は生成元を追跡できるようにする。

最低限:

```json
{
  "derivedFrom": [
    {
      "artifactId": "policy-main",
      "revision": "abc123"
    }
  ],
  "transform": "policy-to-opa",
  "transformVersion": "1",
  "generatedAt": "2026-08-20T00:00:00Z"
}
```

Git 管理された source の場合、revision に commit SHA を利用できる。

ただし Git を必須 backend にはしない。

## Freshness / stale detection

Derived artifact の source revision が変化した場合、再生成が必要であることを判定できるようにする。

```text
Source changed

OPA bundle      stale
BPMN projection up-to-date
Mermaid export  stale
```

初期版では複雑な incremental dependency tracking は行わず、source artifact revision/hash と lineage の比較だけでよい。

概念:

```ts
derived.lineage.sourceRevision !== currentSource.revision
  => stale
```

複数 source を持つ transform では全 source revision/hash を保存する。

## One-way derivation first

初期設計では transformation / projection は原則一方向とする。

```text
source of truth
      ↓
derived artifact
```

生成された BPMN や Mermaid 等を人間が編集した結果を source model へ自動的に逆変換する双方向同期は行わない。

理由:

- transformation は一般に lossless ではない
- inverse transform が一意に定まらない
- conflict resolution が急激に複雑化する
- canonical source の authority が曖昧になる

Derived artifact を手動編集した場合は、lineage を維持しつつ `detached` / `modified` 等の状態にすることを検討する。

```text
Derived artifact modified manually
→ no longer synchronized with source
```

双方向同期は具体的な lossless use case が成立した adapter pair のみ将来検討する。

## Authority

Artifact relationship ごとに source of truth を明確にする。

例えば:

```text
Policy YAML  --compiled-to--> OPA
Policy YAML  --projects-to--> BPMN
```

なら Policy YAML が authority であり、OPA/BPMN は derived artifact である。

逆に import された BPMN が canonical source なら、その BPMN から作られた Mermaid は projection に過ぎない。

Artifact Studio core が特定 artifact type を常に authority と決めない。

## Integration with OPA adapter

OPA adapter はこの architecture の最初の dogfooding target とする。

例:

```text
OPA bundle
   ↓ OPA dependency projection
GraphProjection
   ↓ generic renderer
Mermaid / SVG
```

OPA adapter 自身は Mermaid を知らない。

将来的に external/internal policy compiler が存在する場合:

```text
Domain Policy
   ↓ external transform
OPA bundle
   ↓ OPA adapter
validate / test / eval / visualize
```

Artifact Studio public repository にドメイン固有 Policy schema を持ち込まない。

## Integration with BPMN / n8n

### BPMN

- BPMN topology -> GraphProjection
- generic workflow source -> BPMN transform
- BPMN task -> OPA decision reference

### n8n

- n8n workflow -> GraphProjection
- BPMN process -> n8n implementation relationship
- n8n workflow -> BPMN specification reference

BPMN -> n8n の自動生成を core feature として約束しない。
必要な transform は個別 capability として追加する。

## Persistence

現在の workspace envelope を将来的に artifact graph へ拡張する。

Backward compatibility を維持する。

例:

```json
{
  "version": 2,
  "activeArtifactId": "artifact-1",
  "artifacts": {
    "artifact-1": {
      "adapterId": "bpmn",
      "content": {}
    },
    "artifact-2": {
      "adapterId": "opa",
      "content": {}
    }
  },
  "relationships": []
}
```

現在の adapter 単位 `latest source` 保存方式から一度に全面移行しない。
Migration path を用意する。

## UI concepts

### Artifact graph view

Workspace 内の artifact と relationship を graph 表示できる。

初期版では graph editor ではなく read-only visualization でよい。

### Derived state

Artifact list / header 等に状態を表示する。

- current
- stale
- modified / detached
- invalid

### Regenerate

Derived artifact が stale の場合、元 source から再生成できる。

再生成は明示操作を基本とする。

自動再生成は deterministic / cheap / safe な projection でのみ将来許容する。

## Security / trust boundaries

Transformation は arbitrary code execution の入口になり得るため、transform registry の信頼境界を明示する。

- built-in transform と external transform を区別する
- untrusted artifact content を shell command に直接展開しない
- transform capability ごとに filesystem/network/process access を制限できる設計を目指す
- lineage metadata を trust decision の代替にしない

OPA CLI 等を使う transform/evaluation は各 adapter の security requirements に従う。

## Non-goals

初期段階では以下を行わない。

- arbitrary adapter pair 間の自動変換
- 全 transform の双方向同期
- CRDT / multi-user collaborative graph editing
- Git を Artifact Studio の必須 backend にする
- 汎用 event sourcing
- semantic merge engine
- adapter 固有 domain model を core に統合する
- すべての Projection 型を先に抽象化する

## Suggested implementation order

### Phase 1: contracts

1. Artifact identity を導入
2. relationship / lineage metadata の最小 schema を定義
3. `ArtifactProjection` contract を追加
4. `GraphProjection` を追加
5. generic GraphProjection renderer を追加

### Phase 2: dogfooding

6. OPA dependency graph を GraphProjection で実装
7. Mermaid renderer または既存 Mermaid engine を generic renderer として再利用
8. Dagu で GraphProjection の第2利用例を作る（n8n は将来候補）

第2利用例が成立した時点で abstraction が妥当か再評価する。

### Phase 3: transformation

Completed proof child: `issues/closed/20260821-artifact-transform-registry-lineage-stale-proof.md`. Registry + deterministic transform + lineage/source revision + stale/regenerate proof are complete.

Completed Studio workflow child: `issues/closed/20260821-artifact-transform-regenerate-ui.md`. The existing transform registry is now exposed as a generic Artifact capability in the UI; GraphProjection -> Mermaid can be executed, selected/exported as a derived artifact, reports current/stale from lineage, and requires explicit Regenerate to refresh. No adapter-specific transform routing, background regeneration, detached semantics, or workspace v2 was introduced.

9. `ArtifactTransform` registry を追加
10. deterministic な小さな transform で end-to-end 検証
11. lineage 記録
12. revision/hash ベース stale 判定
13. regenerate UI ✅

### Phase 4: artifact graph

14. workspace persistence v2
15. relationship persistence
16. read-only artifact graph view
17. reference navigation

## Acceptance criteria

- [ ] adapter 間の直接 import を増やさずに連動できる
- [ ] Projection と Transformation と Reference が別概念としてモデル化されている
- [ ] GraphProjection が adapter 非依存である
- [ ] 少なくとも OPA + Dagu が同じ GraphProjection contract / renderer を利用する
- [ ] generated artifact が source artifact / revision を lineage として保持できる
- [ ] source 更新時に derived artifact の stale 判定ができる
- [ ] derived artifact の手動編集を source へ自動逆同期しない
- [ ] workspace が artifact relationships を永続化できる方向に拡張可能である
- [ ] BPMN / Mermaid 等既存 adapter の独立性・回帰互換を維持する
- [ ] Artifact Studio core に業務固有 domain model が入らない

## Design questions to resolve during implementation

- Artifact identity を source file path と独立 UUID にするか
- revision を adapter が提供するか、core が content hash を計算するか
- GraphProjection renderer を Mermaid-backed とするか、専用 SVG renderer を持つか
- Transform registry の discovery / enablement 方法
- external transform を plugin capability として扱うか
- derived artifact の manual edit 状態を `detached` とするか lineage fork とするか
- workspace persistence v2 への migration strategy
- relationship metadata に schema/version を持たせるか

## Architecture summary

```text
                     Artifact Studio
                           │
          ┌────────────────┼────────────────┐
          │                │                │
       Adapters         Transforms       Projections
          │                │                │
        BPMN          Artifact A→B         Graph
        OPA                                Matrix*
        n8n                               Table*
        Mermaid                           Timeline*
        Bento

                         │
                         ▼
                 Artifact Workspace
                         │
                 artifacts + relations
                         + lineage
```

`*` は実需要が複数確認されてから共通化する。

この architecture の中心は「adapter を結合する」ことではなく、**adapter の独立性を維持したまま artifact 同士の意味のある関係を core が扱えるようにすること**である。
