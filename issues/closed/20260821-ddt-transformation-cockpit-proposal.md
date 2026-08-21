# DDT Transformation Cockpit Proposal

Status: closed — superseded as Artifact Studio product direction
Date: 2026-08-21
Target: upper-layer DDT / Transformation application built on Artifact Studio
Implementation: not started in Artifact Studio

Related:
- `issues/open/20260820-artifact-composition-transformation-architecture.md`
- `issues/open/20260820-architecture-graph-semantic-model.md`
- `issues/closed/20260821-artifact-workspace-v2-persistence.md`
- `issues/closed/20260821-artifact-relationship-semantic-ref-core.md`
- `issues/closed/20260821-artifact-transform-registry-lineage-stale-proof.md`
- `issues/closed/20260821-artifact-transform-regenerate-ui.md`

## Closure decision

この proposal は、Artifact Studio 自体の product direction としては close する。

Artifact Studio は public / generic な structured-artifact workbench として維持し、DDT 固有の Transformation / Fact / Question / Decision / Concept / Verification / Observation 等は **Artifact Studio を利用・embedする上位 application layer** に置く。

```text
DDT / Transformation Cockpit
        ↓ uses / embeds
Artifact Studio
        ↓
BPMN / OPA / Dagu / Mermaid / ...
```

この文書の DDT domain model / lifecycle / governance / verification 構想は、将来の上位アプリ設計資料として保存する。Artifact Studio 側で必要な generic extension point は `issues/open/20260821-upper-layer-application-extension-points.md` に切り出した。

## Summary

Artifact Studio を基盤として、**Transformation を中心に Domain-Driven Transformation (DDT) を実務で回す Cockpit** を上位アプリとして bottom-up に構築する。

新しい方法論を作ることは目的としない。Carola Lilienthal / Henning Schwentner の Domain-Driven Transformation を基礎とし、DDD、Clean Architecture、DMMF 等は必要な範囲で利用する。

本 proposal の中心は図や Artifact ではなく **Transformation** である。

```text
Human / Domain Expert
        ↓
Collaborative clarification / grilling
        ↓
Transformation
        ↓
Semantic relationship layer
        ↑
repositories + local MCP + knowledge layer
        ↓
Impact Analysis
        ↓
Manual / BPMN / Policy / Schema / Code / Integration
        ↓
Verification
        ↓
Runtime / Evidence
        ↓
Observation
        ↓
Next Transformation
```

`Architecture Studio`、`Architecture Graph` は現時点では仮称とする。特に建設業では architecture / 設計 / 構造 / modeling 等が既存概念と衝突しやすいため、意味を先に固定し、名称は別途再検討する。

## Why

現状の Artifact Studio では、BPMN / OPA / Mermaid / Dagu 等を adapter として独立に扱い、artifact identity、relationship、transform、lineage、stale detection まで実装が進んでいる。

次の課題は、Artifact をさらに増やすことではない。

実務上必要なのは次を一続きで扱うことである。

- 何を変えたいのか
- 現状について何が分かっているか
- 何が不明か
- 何を決めたか
- どの Concept / Artifact / Repository に影響するか
- 何を変更したか
- 変更が Decision を反映しているか
- 検証できたか
- Runtime で期待どおりだったか
- 次に何を変えるべきか

これを Transformation を第一級 Artifact として扱うことで接続する。

## Core principles

### 1. Transformation is the primary work context

v1 の主導線は Artifact 一覧ではなく、次とする。

```text
Transformation list
  → Transformation Cockpit
      → Artifact views / editors
```

BPMN / Policy / Manual / Code 等は Transformation の中で参照・編集・検証する。

### 2. Existing Artifact Studio remains the foundation

Artifact Studio は generic foundation として利用する。

DDT domain model は Artifact Studio core / adapter として実装しない。上位アプリの repository / package 境界は、最小実装を開始する時点で分離する。

再利用対象:

- artifact core
- adapter registry
- workspace v2
- stable artifact identity
- ArtifactRelationship / SemanticRef
- transformation registry
- lineage
- stale / regenerate
- runtime registry
- existing BPMN / OPA / other adapter views

既存 Artifact 直接操作は移行期間中も残す。

### 3. Artifact bodies remain authoritative in their repositories

各 Artifact 本体の正本は各 canonical source / Repository に残す。

例:

```text
BPMN XML      = process authority
Rego          = policy authority
JSON Schema   = data contract authority
source code   = implementation authority
Manual        = human-readable operational authority
```

Studio 自体を全情報の唯一の正本にしない。

### 4. The shared layer is semantic, not a mega-model

現在 `Architecture Graph` と仮称している層は、すべてを1つの schema に変換するものではない。

中心要素は次に限定する。

- Concept / Term / Context
- Semantic Relationship
- Transformation / Decision
- Artifact reference
- Contract reference
- Evidence reference

以下の本文は保持しない。

- business records
- runtime logs themselves
- Manual body
- source code body
- secrets / credentials
- personal data body

Graph DB / search index / visualization は derived representation とし、canonical storage は Git 管理可能な declarative files を基本とする。

## Transformation lifecycle

Human-facing の標準状態は次とする。

```text
発見 → 明確化 → 決定 → 実施 → 検証 → 観測 → 完了
```

`モデリング` は使用しない。建設業における BIM/CIM 等との混同を避け、ここでは **明確化** を採用する。

この lifecycle は DDT 書籍の章立てをそのまま状態機械化したものではなく、DDT を変更・検証・観測まで実務運用するための lifecycle とする。

### Lifecycle rules

- 状態は作業を禁止する rigid workflow にしない。
- 後段階でも新しい Fact を発見できる。
- 必要なら前段階へ戻れる。
- `完了` / `取消` は原則終端とする。
- 完了後に新問題が見つかった場合、元 Transformation を reopen せず新しい Transformation を作成する。
- `停止中` は進捗状態とは別軸で保持する。
- 検証失敗を終端状態 `失敗` にはしない。

### 明確化の出口

すべてを理解することを要求しない。

最低限、次が明示され Decision 可能な状態になればよい。

- 目的
- Scope
- 現時点の Fact
- 不明点
- 決定すべき問い

## Transformation Artifact

Transformation は単一巨大 YAML ではなく bundle とする。

概念例:

```text
transformations/
  tr-xxxx/
    transformation.yaml
    README.md
    evidence/
    generated/
```

### Structured canonical data

`transformation.yaml` 等には次を保持できるようにする。

- stable Transformation ID
- goal
- scope
- progress state
- operational state
- Fact refs
- Question refs
- Decision refs
- affected Concept refs
- affected Artifact refs
- affected Repository refs
- verification conditions
- observation conditions
- related Transformations
- provenance / revisions

Human-authored canonical YAML は日本語キーを許容する。

### Long-form text

背景、議論、判断理由等の長文は Markdown 等へ分離する。

AI grilling transcript 全文は canonical artifact にしない。そこから確定した Fact / Question / Decision / unresolved item を構造化する。元 transcript への provenance link は保持可能とする。

Decision / Concept / Evidence 本体を Transformation ごとにコピーせず参照する。

## Concept and language model

DD / DDD / DDT 周辺の弱点として、抽象概念の言語化は難しい。

本設計ではこの問題を避けず、**抽象概念を抽象概念のまま扱いつつ、人間が読める言葉を発見・再発見すること自体をドメイン知識とする。**

### Concept and Term are separate

```text
Concept = stable semantic identity / meaning
Term    = human-readable name used for a Concept
```

名称変更で Concept identity を変更しない。

Concept ID は preferred term を恒久 ID にせず、stable Semantic ID とする。Readable slug は補助情報でよい。

### Context

概念解決は概ね次で扱う。

```text
Term + Context → Concept
```

Context は DDD Bounded Context に限定しない。

例:

- company
- branch
- business domain
- system
- Manual
- Bounded Context

Context は木構造に限定しない。

### Vocabulary behavior

- 同じ Term でも意味が違えば別 Concept。
- Context が異なっても意味が同じなら同じ Concept を参照できる。
- preferred term は Context ごとに持てる。
- preferred term は原則であり絶対命令ではない。
- 禁止・抑制したい語は `避ける語` / explicit rule で表現する。
- 多言語 Term を同じモデルで扱う。
- human-facing 第一言語は日本語。
- Concept の merge / split は履歴化する。
- naming change も Decision として履歴化する。
- similar / same candidate / decided-same を区別する。
- AI は Concept identity を自動確定しない。

Concept definition は短い辞書文だけに限定せず、必要に応じて次を持てる。

- 要旨
- 含むもの
- 含まないもの
- 関連 Concept
- 具体例
- provenance

Context ごとの glossary は別正本として手書き管理せず、Concept / Term / Context relationship から projection する。

## Authority states

Human-facing では少なくとも次を区別する。

- 明示 (`declared`)
- 決定 (`decided`)
- 発見 (`discovered`)
- 観測 (`observed`)
- 推定 (`inferred`)

AI / adapter が自動的に作成・更新できるのは主に発見・観測・推定・candidateであり、決定済み情報へ自動昇格させない。

Concept / Vocabulary は完成前提にしない。

成熟度の例:

- 発見
- 明確化中
- 決定
- 利用実績あり

## Fact / Decision / Evidence

Fact と Decision を混ぜない。

```text
Fact     = 現状について確認できたこと
Decision = 今後どうするかについて人間が確定した判断
Evidence = Fact / verification / observation 等の根拠
```

### Decision

Decision は少なくとも次を参照可能にする。

- decision content
- rationale
- supporting Facts / Evidence
- alternatives considered
- related Concept / Artifact
- related Transformation
- proposer / author / decider / approver

AI proposal は Decision Candidate であり、human Actor が採用したときのみ Decision となる。

Decision は上書きしない。

```text
Decision B → replaces → Decision A
```

置換・取消理由を残す。

### Evidence freshness

Evidence には取得時点・revision・source を持たせる。

例えば Repository 由来 Evidence は commit SHA 等へ pin できる。

過去 Evidence は後日の更新で書き換えず、当時の対象 revision に対して成立した証拠として保持する。

## Semantic identity and relationships

Repository / Artifact local identity と Semantic identity を分離する。

```text
Semantic Concept / Entity
        ↑ mapping
BPMN element / code symbol / schema path / local artifact identity
```

Rename / regenerate / refactor で Semantic identity を壊しにくくする。

共有 Concept は semantic layer 側で一意な stable ID を持ち、Repository は Contract Slice 経由で参照する。

### Relationship type

Relationship Type も単なる文字列ではなく意味語彙とする。

最低限:

- stable ID
- human-facing 日本語名称
- meaning
- direction
- applicable source / target kinds

Relationship は canonical direction を1つだけ保存し、逆方向は projection する。

Temporal information は意味上必要な Entity / Relationship のみに持たせる。

## Contradiction / Gap / semantic drift

自動的に矛盾を解消しない。

少なくとも次を first-class candidate として扱う。

- Contradiction
- Coverage Gap
- ambiguous Term
- conflicting preferred terms
- Concept drift
- unimplemented Decision
- broken / unresolved semantic ref
- design/runtime drift

これらは必要に応じて新しい Transformation candidate となる。

## Impact Analysis

AI の自由推論だけにしない。

```text
deterministic semantic graph traversal
  → impact candidates
  → AI semantic review
  → human confirmation where needed
```

確定関係と未確定候補を区別する。

- 明示 / 決定 → confirmed impact paths
- 発見 / 推定 → impact candidates

preferred term の変更も Artifact rename を自動実行せず、影響候補を提示する。

## Contract Slice

各 Repository は semantic layer 全体ではなく、必要な部分だけの Contract Slice に依存する。

概念:

```text
Semantic relationship source of truth
        ↓ project
repository-specific contract slice
        ↓
Repository CI / validation
```

含められるもの:

- Semantic IDs
- relevant Concept names / meanings
- related relationships
- Data Contract refs
- Policy refs
- Process refs
- dependency rules
- graph revision / hash

規範的な Contract Slice には原則として人間が確認した情報だけを含める。

- 明示
- 決定

発見 / 観測 / 推定を Repository の normative dependency にしない。

Graph change により Slice が変化した場合:

```text
Graph change
  → regenerate slice
  → PR to affected repository
  → repository CI / review
```

Cross-repository transaction は作らない。

## Verification and Observation

PR merge / deployment だけを Transformation 完了条件にしない。

### Verification condition

Verification Plan は individual verification conditions として追跡する。

各条件は必要に応じて次を持つ。

- what to verify
- success criteria
- related Decision / Concept
- verification method
- Evidence

機械検証と人間確認を区別する。

- machine: CI / policy test / schema validation
- human: business judgment / Manual adequacy

AI review は自動的に人間確認の代替とはしない。

### Observation

必要に応じて次を保持する。

- what to observe
- expected state
- deployment / revision
- observation period / condition
- resulting Evidence
- judgment

Runtime 観測が意味を持たない Transformation では `対象外` を明示できる。

本来必要な検証・観測を免除する場合は Decision として理由を残す。

必要条件の充足は機械集計可能にするが、`完了` の最終確定は人間が行う。

## Governance / Policy / Waiver

DDT Core に組織固有の承認権限を埋め込まない。

例:

- 部長のみ決定可能
- 特定部署承認が必要
- 特定Decisionには二者承認が必要

これらは Policy として外出しする。

Policy が状態遷移条件を要求する場合、未充足なら `決定 → 実施` 等を原則ブロックする。

Decision成立時には適用した Policy revision / evaluation result を Evidence として残す。

後日の Policy 変更で過去 Decision を遡及無効化しない。不一致は新しい Transformation candidate とする。

### Waiver

例外機構を乱立させず、期限付き Waiver を共通利用する。

最低限:

- target
- violated rule / policy
- reason
- related Transformation
- expiry
- approving Actor
- status

期限切れ Waiver は自動延長せず、対象違反は再び validation failure として扱う。

有効な Waiver は、その対象違反に限り Policy block を一時解除できる。

## Actor / Identity boundary

Core では Actor への論理参照を持つ。

Actor candidate:

- Person
- Role
- Group
- System

ただし System / AI は Decision Candidate を生成できても DDT Decision を単独確定しない。

Identity / Organization の正本は外部 source に置き、Studio 自身に社員・組織 master を抱えない。

Role による承認では、Audit / Evidence として当時の実行 Person と Role assignment を残す。

過去 Actor Evidence は現在の組織状態で上書きしない。

重要操作で必要な Identity / Organization source を確認できない場合は fail closed とする。

## UI direction — Transformation Cockpit v1

v1 は万能 Graph Browser / Graph Editor を目指さない。

Cockpit candidate:

- Goal / Scope
- Current understanding
- Facts / Provenance
- Questions / Decisions
- Concept / Vocabulary clarification
- relevant semantic slice
- Contradictions / Gaps
- Impact Analysis
- Proposed Changes
- Repository Changes
- Verification
- Observation

BPMN / OPA / Manual / code 等は Cockpit 内の専門 View / Editor とする。

Generic Graph Editor は v1 には入れない。Graph change は Concept clarification、Decision、Artifact binding 等の Transformation operation の結果として行う。

AI が変更を生成する場合は原則として:

```text
proposal
  → diff / impact review
  → apply
```

とし、grilling 完了直後に無条件で Repository を変更しない。

## Bottom-up migration

実装は既存 Artifact Studio から bottom-up に進める。

### Existing assets

既存 Workspace / Artifact は Transformation ID を持たないまま存在可能とする。

架空の Transformation を生成して過去 Artifact を無理に所属させない。

必要な時点で実在 Transformation から関連付ける。

### Repository strategy

Artifact Studio 側には generic extension point のみ実装する。

Transformation / Fact / Decision / Concept 等の DDT 固有 model と Cockpit UI は、Artifact Studio とは別の上位 application/repository に置く。Artifact Studioを DDT adapter 化しない。

## Suggested implementation phases

### Phase 0 — proposal / contract alignment

- this proposal review
- reconcile existing `ArtifactRelationship` / `SemanticRef` with the broader semantic model
- define minimal Transformation bundle contract
- define stable IDs and schema versioning
- no UI replacement yet

### Phase 1 — Transformation core

- Transformation identity
- lifecycle state
- bundle persistence
- Fact / Question / Decision references
- affected Artifact / Repository references
- migration-safe coexistence with current workspace

### Phase 2 — Cockpit shell

- Transformation list
- Transformation Cockpit routing/layout
- existing Artifact Studio editor embedded/reused as contextual views
- keep direct Artifact workflow available

### Phase 3 — Concept / Vocabulary slice

- Concept / Term / Context minimal model
- stable Semantic IDs
- Artifact local identity mapping
- human-facing Japanese vocabulary projection
- discovered vs decided mappings

### Phase 4 — Impact / Gap

- deterministic relationship traversal
- confirmed impact vs candidate impact
- Contradiction / Coverage Gap
- AI semantic review layer

### Phase 5 — Repository Contract Slice

- repository registry
- graph slice projection
- generated repository contract
- revision/hash
- PR-oriented delivery workflow

### Phase 6 — Verification / Observation

- verification conditions
- machine / human verification distinction
- Evidence refs
- observation conditions
- completion readiness aggregation

### Phase 7 — Governance

- Policy evaluation hooks
- Actor refs
- Waiver
- state transition guards
- external Identity / Organization integration boundary

Implementation phases are intentionally incremental. Do not require a complete semantic graph before useful Transformation workflows become available.

## Non-goals

Initial implementation must NOT:

- create a new proprietary DDT methodology
- build a universal enterprise architecture repository
- introduce a universal modeling language
- replace Artifact canonical formats with one schema
- require all existing Artifacts to belong to a Transformation
- require a complete organization-wide vocabulary before starting
- make AI authoritative for Decision
- auto-resolve contradictions
- auto-rename every Artifact when preferred terminology changes
- require runtime observation where it has no meaning
- become an identity / HR master
- become a monitoring product
- implement cross-repository atomic transactions
- make Git, Graph DB, or a central server mandatory runtime dependencies for every Repository
- start with a general-purpose Graph Editor

## Artifact Studio / upper-layer boundary

Public Artifact Studio core may contain:

- Artifact identity / content / workspace contracts
- adapter registry and embeddable editor/view capabilities
- ArtifactRelationship / SemanticRef generic primitives
- transform / lineage / stale / regenerate primitives
- generic repository / external-resource references
- generic provenance / revision references
- proposal / diff / review / apply extension points
- HostRuntime and persistence boundaries
- generic relationship traversal / projection primitives

The upper-layer DDT application owns:

- Transformation lifecycle
- Fact / Question / Decision / Evidence domain model
- Concept / Term / Context domain model
- DDT-specific Impact Analysis
- Verification / Observation workflow
- governance / approval / Waiver semantics

Public core must not contain:

- company-specific roles
- company-specific approval rules
- kintone app mappings
- private repository registry data
- internal organization model
- credentials / endpoints
- business records

## Acceptance criteria for first milestone

The first useful milestone does not need to implement the whole proposal. It should demonstrate the new direction without breaking existing Artifact workflows.

- [ ] A Transformation has stable identity and persisted lifecycle state.
- [ ] Existing Artifacts can remain unassociated with a Transformation.
- [ ] A Transformation can reference existing Artifact identities.
- [ ] Fact / Question / Decision can be represented distinctly at least at reference level.
- [ ] Transformation list → Cockpit navigation exists.
- [ ] Existing Artifact editor can be reached from the Cockpit without adapter-specific coupling.
- [ ] Existing direct Artifact workflow still works.
- [ ] AI-generated changes are presented as proposed changes rather than silently applied.
- [ ] No company-specific domain model is added to public core.
- [ ] Existing workspace / transform / relationship / lineage tests remain green.

## Longer-term success criteria

The system should eventually answer, from a Transformation context:

```text
What are we changing and why?
What do we currently know?
What remains unclear?
Which Concept does this term mean here?
Which Decisions establish the target state?
Which Artifacts and Repositories implement those Decisions?
What is affected if this Concept / Contract / Policy changes?
Which Decisions have not been reflected in implementation?
What was verified, against which revision?
What was observed after deployment?
What contradiction or drift should become the next Transformation?
```

The goal is not to keep multiple diagrams synchronized manually. The goal is to maintain independent authoritative Artifacts while making their **meaning, Decisions, implementation, verification, and runtime evidence traceable through Transformation**.
