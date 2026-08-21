# Architecture Graph / Semantic Relationship Model

Status: open
Date: 2026-08-20
Target: As-Code Studio semantic graph capability
Related:
- `issues/closed/20260820-artifact-composition-transformation-architecture.md`
- `issues/closed/20260820-opa-adapter.md`
- `issues/closed/20260820-dagu-adapter.md`
- `issues/open/20260820-n8n-adapter.md` (deferred)
- `docs/ARTIFACT-ADAPTERS.md`

## Summary

As-Code Studio の product boundary を維持したまま、**異なるas-code Artifactの意味的関係を横断して扱う generic capability** として Architecture Graph を追加する。

Architecture Graph は別product名へのrename理由ではなく、As-Code Studio core/workspaceが提供するsemantic infrastructureとする。中心概念は diagram ではなく **Artifact + SemanticRef + relationship graph** である。

```text
Artifact
  ├─ exposes Semantic Entity
  ├─ references Semantic Entity
  ├─ transforms-to Artifact
  ├─ projects-to View
  ├─ implemented-by Artifact
  └─ derived-from Artifact revision
```

Architecture Graph は、BPMN / OPA / n8n / Mermaid / Data Model / Data Contract / DDD model / source code 等を、
各adapterの独立性を保ったまま意味的に接続する共通層である。

この設計により、例えば次を同じWorkspace上で辿れるようにする。

```text
Business Entity: Invoice.amount
  ├─ defined-in      → business-data-model
  ├─ constrained-by  → JSON Schema
  ├─ used-by         → BPMN task
  ├─ validated-by    → OPA rule
  ├─ transformed-by  → n8n node
  └─ persisted-to    → external system field
```

## Motivation

現在のadapter architectureでは、各artifact typeは意図的に独立している。
これは正しい境界だが、実際のシステム設計ではartifactは独立して存在しない。

例:

- BPMNは制御フローを表すが、DataObject内部の業務データ構造までは十分に表現しない
- OPAは判断・制約を表すが、その判断対象となる業務データや業務プロセスとは別artifactである
- n8nは実際のデータ変換・API連携を実装できるが、そのworkflowだけでは業務意味論を完全には表現しない
- JSON Schema等はデータ構造を定義できるが、どのprocess/task/policyで使われるかは表現しない
- DDD/Clean Architectureのモデルは、実装artifactとの関連を持たなければ静的な設計図になりやすい

必要なのは全てを1つの巨大schemaへ統合することではなく、
**各artifactを独立させたまま、意味的な関係を第一級データとして扱うこと**である。

## Product direction: Architecture Graph inside As-Code Studio

Product名は **As-Code Studio** とする。Architecture Graphはその内部capabilityであり、別の「Architecture Studio」へrenameしない。

```text
As-Code Studio
│
├─ Artifact Adapters
│   ├─ BPMN
│   ├─ Mermaid
│   ├─ OPA
│   ├─ Dagu
│   ├─ Bonita BDM
│   └─ future as-code formats
│
├─ Artifact Workspace
├─ Architecture Graph
├─ Transformations / Projections
├─ Lineage
└─ Validation / traversal / impact analysis
```

`Artifact` と各adapter-owned canonical formatを中心に据え、Architecture Graphがそれらを置き換えるuniversal modelにはしない。

## Core principles

### 1. Adapter independence

Adapter同士は直接importしない。

NG:

```text
OPA adapter -> Mermaid adapter
n8n adapter -> BPMN adapter
```

Instead:

```text
OPA adapter
  -> Architecture Graph / GraphProjection
  -> renderer
```

### 2. Semantic relationships are first-class

ファイル同士を紐付けるだけでは不十分。
Artifact内部の意味的要素をaddress可能にする。

```text
artifact://business-model/orders#/Order/total
artifact://bpmn/order-process#/task/approve
artifact://opa/order-policy#/rule/allow_discount
artifact://n8n/order-sync#/node/normalize-order
```

URI表現は例であり、最終仕様は別途決める。

### 3. No universal mega-model

BPMN / Rego / n8n / DDD 等を1つの巨大canonical schemaへ変換しない。

各adapterが自身のcanonical modelを所有する。
共通化するのは次のみ。

- artifact identity
- semantic entity identity/address
- relationship
- lineage
- projection contracts

### 4. Relationships may be declared or discovered

関係は2種類存在する。

#### Declared

利用者またはartifact metadataが明示する関係。

```text
BPMN task implemented-by n8n workflow
```

#### Discovered

adapter/parser/analyzerがartifactから抽出する関係。

```text
Rego rule reads data.invoice.amount
n8n node writes external field X
```

両者を区別して保持する。

### 5. Design-time and runtime must remain distinguishable

設計上の関係と実行時観測結果を混同しない。

```text
design:
  n8n workflow writes Invoice

runtime:
  run #123 actually wrote Invoice id=456
```

Runtime lineageは将来拡張可能とするが、初期Architecture Graphはdesign-time中心とする。

## Architecture Graph logical model

初期案:

```ts
interface ArchitectureArtifact {
  id: string;
  adapterId: string;
  revision?: string;
  label?: string;
}

interface SemanticEntity {
  id: string;
  artifactId: string;
  kind: string;
  label?: string;
  address?: string;
  metadata?: Record<string, unknown>;
}

interface ArchitectureRelationship {
  id: string;
  type: string;
  from: SemanticRef;
  to: SemanticRef;
  provenance: 'declared' | 'discovered' | 'generated';
  sourceAdapter?: string;
  metadata?: Record<string, unknown>;
}

interface SemanticRef {
  artifactId: string;
  entityId?: string;
  address?: string;
}
```

これは概念案であり、実装時により小さくしてよい。

## Relationship taxonomy

Relationship typeを完全固定enumにしない。
ただしcommon vocabularyは提供する。

初期候補:

### Structural

```text
contains
defined-in
instance-of
schema-of
```

### Usage

```text
uses
reads
writes
consumes
produces
```

### Governance

```text
validated-by
governed-by
constrained-by
decided-by
```

### Implementation

```text
implemented-by
calls
persists-to
exposes
```

### Derivation

```text
derived-from
transforms-to
projects-to
generated-from
```

### Domain / Architecture

```text
belongs-to-context
implements-use-case
publishes-event
subscribes-to-event
depends-on
```

未知relationship typeもadapter/pluginから追加可能にする。

## Business Data Model

BPMN DataObjectの不足を補うため、Business Data Modelを独立artifactとして扱えるようにする。

Bonita BDM的な考え方を参考にするが、Bonita形式そのものへの依存は避ける。

役割:

```text
Business Data Model
= 業務上の概念・属性・関連
```

例:

```yaml
entities:
  Invoice:
    fields:
      invoiceNumber:
        type: string
      supplier:
        ref: Supplier
      amount:
        type: decimal

  Supplier:
    fields:
      supplierCode:
        type: string
      name:
        type: string
```

Business Data Modelはlogical modelであり、DB table definitionではない。

## Data Contract

Business Data Modelと実際に受け渡すpayload schemaを分離する。

```text
Business Data Model
      ↓ realizes-as
Data Contract
```

Data Contractの実装形式例:

- JSON Schema
- OpenAPI Schema
- XML Schema
- Avro
- Protobuf

`DTD` という共通名称はXML Document Type Definitionと曖昧になるため避け、
Architecture Studio上の概念名は `Data Contract` を推奨する。

## BPMN integration

BPMNはControl Flowのauthorityとする。
DataObject自体へ巨大なschemaを埋め込まない。

BPMN側のsemantic entityが外部Business Data Model/Data Contractをreferenceできるようにする。

概念例:

```text
BPMN DataObject: Invoice
  ├─ semantic-model → BusinessModel.Invoice
  └─ data-contract  → invoice.schema.json#/Invoice
```

BPMN adapterはBusiness Data Modelの意味論を理解する必要はない。
Architecture Graph上のrelationshipを公開すればよい。

## OPA integration

OPAはDecision / Constraint Modelとして位置づけられる。

例:

```text
OPA rule: payment.allow
  ├─ reads → Invoice.amount
  ├─ reads → Employee.role
  └─ governs → BPMN task: ApprovePayment
```

Rego static analysisから`input` / `data`参照を抽出し、
Business Data Modelのsemantic entityとbindingできる構造を検討する。

## n8n integration

n8nはlogical lineageそのものではなく、
**executable integration / transformation implementation** として扱う。

```text
Logical lineage:
RawInvoice
  -> Invoice
  -> InvoiceRecord

Physical implementation:
n8n webhook
  -> normalize node
  -> kintone/API node
```

binding例:

```text
normalize-invoice
  implemented-by → n8n workflow/node
```

これにより将来、同じlogical transformationをPython/dbt/other engineで実装してもArchitecture Graphを維持できる。

## Data Lineage

Architecture Graphのrelationshipを利用して、dataset/entity/field-level lineageを表現する。

最低3粒度を想定する。

### Artifact-level

```text
source CSV -> n8n workflow -> kintone dataset
```

### Entity-level

```text
RawInvoice -> Invoice -> InvoiceRecord
```

### Field-level

```text
RawInvoice.vendor_name
  -> normalizeVendor
  -> Invoice.supplier.name
```

初期実装ではartifact/entity-levelを優先し、field-levelはschema/addressing modelが安定してから拡張する。

OpenLineage等の標準とのmapping可能性を維持するが、初期版で完全準拠を必須にしない。

## Domain-Driven Design support

DDDを特別扱いするのではなくArchitecture Graph vocabularyの利用例として実装できるようにする。

Semantic entity candidates:

- Bounded Context
- Aggregate
- Entity
- Value Object
- Domain Service
- Domain Event
- Command
- Policy

Relationships:

```text
Aggregate belongs-to-context BoundedContext
UseCase uses Aggregate
Aggregate publishes DomainEvent
Context consumes DomainEvent
Policy governs Aggregate
```

Context MapはArchitecture Graphのprojectionとして生成可能にする。

## Clean Architecture support

Clean Architectureもprojection + validationとして扱う。

Example entities:

```text
Entity
Use Case
Interface Adapter
Framework / Driver
```

Relationship:

```text
depends-on
implements
calls
```

Architecture rule example:

```text
outer layer may depend on inner layer
inner layer must not depend on outer layer
```

これにより図示だけでなくarchitecture-as-code validationを可能にする。

例:

```text
Domain -> Infrastructure
```

の禁止依存をCIで検出できる。

## Architecture projections

Architecture Graphから複数viewを生成する。

初期候補:

### Dependency Graph

Artifact / component dependency。

### Domain Map

Bounded Context / Aggregate / Domain Event。

### Data Lineage

consume / transform / produce。

### Process + Data

BPMN control flowにBusiness Data entityの関係をoverlayする。

### Policy Map

BPMN task / Business Entity / OPA ruleの関連。

### Implementation Map

logical process -> n8n/API/database等のphysical implementation。

### Impact Analysis

任意semantic entityからreverse edge traversalして影響対象を表示する。

例:

```text
Invoice.amount changed
  ├─ affects JSON Schema
  ├─ affects OPA rule
  ├─ affects BPMN approval task
  └─ affects n8n mapping
```

## Semantic addressing

Architecture Graphの実用性には、Artifact内部要素のstable addressingが重要。

要求:

- adapter-owned IDsを可能な限り利用
- filename/display labelをidentityにしない
- renameでrelationshipが壊れにくい
- imported artifactsでもstable ID抽出を試みる
- addressはhuman-readable、identityはimmutable IDでもよい

BPMNではelement id、n8nではnode id、OPAではpackage/rule path等を利用可能。

Business Data Modelではentity/fieldのimmutable ID導入も検討する。

## Lineage and revision

Architecture Graph edgeはsource revisionを追跡できるようにする。

```json
{
  "from": "artifact-a@abc123",
  "to": "artifact-b@def456",
  "type": "generated-from"
}
```

Git管理対象ではcommit SHAを利用できる。
Browser local workspaceではcontent hash / revision idを使う。

これによりderived artifactのstalenessを判定可能にする。

## Relationship validity / stale state

Relationshipまたはderived artifactは次の状態を取り得る。

```text
current
stale
broken
unresolved
detached
```

例:

- source revisionが更新された → stale
- target semantic entityが消えた → broken
- external artifact未ロード → unresolved
- generated artifactを手動編集した → detached

## Architecture validation

Architecture Graph自体にrule engineを適用できるようにする。

例:

### Referential integrity

- broken semantic reference
- missing target artifact
- stale generated artifact

### Clean Architecture

- forbidden inward/outward dependency

### DDD

- cross-context direct database dependency
- aggregate boundary violation

### Data governance

- sensitive entity written to unapproved sink
- field has producer but no owner/schema

### Process / Implementation

- BPMN automated task has no implementation binding
- n8n workflow exists but no design artifact binding

Rule engineとして将来的にOPA adapter自身をdogfoodすることも可能。

## As-Code Studio Architecture Graph workspace

Workspaceは単なるartifact storageからArchitecture Graph containerへ拡張する。

概念:

```ts
interface ArchitectureWorkspace {
  artifacts: Record<string, ArtifactRecord>;
  relationships: ArchitectureRelationship[];
  metadata?: object;
}
```

既存workspace persistenceとのmigration pathを持つ。

既存BPMN/Mermaid単体利用は引き続き可能にする。
Architecture Graph利用を必須にしない。

## UI direction

初期UIは大規模EA toolを目指さない。

追加候補:

### Architecture view

Workspace内artifactとrelationshipをgraph表示。

### Inspector

選択entityについて:

```text
Defined in
Used by
Validated by
Implemented by
Produces
Consumes
```

を表示。

### Impact mode

選択entityからdownstream / upstreamをhighlight。

### Artifact-local view

BPMN/OPA/n8n等の既存adapter UIは維持する。
Architecture Graphはその上位navigationとして追加する。

## Source of truth

As-Code Studio / Architecture Graph自体を全設計情報の唯一の正本にしない。

各artifactのauthorityは各adapter/canonical sourceにある。

```text
BPMN XML        = BPMN authority
Rego            = Policy authority
n8n JSON        = n8n workflow authority
JSON Schema     = contract authority
Business Model  = domain data authority
```

Architecture Graphはそれらの**関係のauthority**となる。

## Generated vs authored relationships

Relationshipにはoriginを記録する。

```text
authored
inferred
transformed
runtime-observed
```

inferred relationshipは再解析で更新可能。
authored relationshipを自動解析で上書きしない。

## Avoid premature bidirectional synchronization

Semantic linkを持つことと双方向同期は別問題。

初期版では:

```text
source -> derived artifact
```

を基本とする。

BPMN編集からBusiness Modelを自動変更する等のlossyなreverse transformは行わない。

## Relation to Artifact Composition proposal

closed済みの `artifact-composition-transformation-architecture` が Artifact A → Artifact B の変換・projection・lineage基盤を確立した。
本issueはその上に **semantic entity / relationship graph** を追加するfollow-upである。

```text
Artifact Composition
        ↓
Architecture Graph
        ↓
Semantic relationships / impact analysis / architecture validation
```

両issueは競合せず、本issueがより一般的なsemantic layerとなる。

## Suggested implementation phases

### Phase 0 — Logical contract only

- ArchitectureArtifact
- SemanticEntity
- ArchitectureRelationship
- SemanticRef
- provenance
- revision

実装前に最小schemaを固定する。

### Phase 1 — In-memory graph + Mermaid/BPMN dogfood

- generic ArchitectureGraph store
- artifact-level relationship
- BPMN element IDsをSemanticEntityとして公開
- Mermaid/GraphProjectionでarchitecture graph表示

### Phase 2 — OPA integration

- package/rule semantic entities
- input/data reference extraction
- `validated-by` / `reads` relationship

### Phase 3 — n8n integration

- workflow/node semantic entities
- implemented-by relationship
- consumes/produces basics

### Phase 4 — Business Data Model + Data Contract

Bonita BDM adapter (`bdm/bom.xml`) is now implemented and provides a real external canonical data-model artifact. Do **not** introduce an As-Code Studio-specific generic BDM canonical schema.

- expose Bonita Business Object / field identities as SemanticEntity/SemanticRef targets
- entity/field semantic addressing
- future JSON Schema mapping
- future BPMN DataObject binding

### Phase 5 — Data Lineage

- entity-level lineage
- field-level lineage where possible
- impact analysis

### Phase 6 — DDD / Clean Architecture projections and validation

- Context Map
- architecture layers
- dependency rules
- architecture-as-code checks

### Phase 7 — Runtime linkage (optional/future)

- n8n execution observations
- OpenLineage-compatible export/import investigation
- design vs runtime drift detection

## Non-goals

Initial implementation must NOT:

- become a full Enterprise Architecture repository
- replace BPMN/OPA/n8n native formats with one schema
- implement a universal modeling language
- require all adapters to understand DDD
- require full field-level lineage from day one
- implement arbitrary reverse transforms
- reimplement n8n execution engine
- reimplement OPA semantics
- parse source code for every programming language
- require central server/database

## Public repository boundary

この機能はpublic As-Code Studio repositoryで一般化可能。

Public repoに入れてよいもの:

- Architecture Graph logical model
- generic semantic addressing
- relationship/provenance/revision model
- Business Data Model generic adapter
- Data Contract adapters
- BPMN/OPA/n8n relationship extraction
- DDD / Clean Architecture generic vocabulary/projections
- impact analysis
- lineage primitives

Public repoに入れないもの:

- 特定企業の役割名
- 社内業務Policy schema
- kintone app固有field mapping
- 固有承認制度
- private endpoint / credentials

## Current progress / next slice

- 2026-08-21: transform/lineage freshness workflow completed.
- 2026-08-21: Artifact Workspace v2 completed stable multi-artifact identity, migration and reload-safe lineage freshness.
- 2026-08-21: open-vocabulary `ArtifactRelationship` + `SemanticRef` persistence and referential validation completed. Provenance distinguishes `declared`, `discovered`, and `generated`.
- 2026-08-21: Bonita BDM adapter added with canonical `bdm/bom.xml`, Business Object/field parsing and relationship GraphProjection. This removes the need to invent a generic BDM format before semantic-entity work.

**Next implementation slice:** define the minimal `SemanticEntity` exposure contract and use Bonita BDM Business Objects/fields as the first provider. Then project persisted ArtifactRelationships/SemanticRefs into a read-only graph and add generic traversal.

## Acceptance criteria for first implementation milestone

- [x] Artifact-level `ArtifactRelationship` / `SemanticRef` logical contractが存在する
- [x] Artifact単位のrelationshipをworkspaceに保存・復元できる
- [ ] Artifact内部`SemanticEntity`を最低1adapterで公開できる
- [ ] persisted relationshipをgeneric `GraphProjection`として表示できる
- [x] declared / discovered / generated provenanceを区別できる
- [x] source revision変更によるstale判定の基礎がある
- [x] broken/unresolved Artifact/SemanticRefを検出できる基礎がある
- [x] BPMN/Mermaid既存機能が回帰しない
- [x] 特定企業/業務ドメインの知識をcoreに持ち込まない

## Success criteria for Architecture Graph capability

将来的に次の問い合わせに答えられることを成功条件とする。

```text
この業務データは何か？
どのschemaで定義されているか？
どのBPMN processで使われるか？
どのPolicyが制約するか？
どのn8n workflowが処理するか？
どのsystemへ保存されるか？
このfieldを変更したら何に影響するか？
実装はClean Architecture上のdependency ruleを守っているか？
このBounded Contextは他contextとどう連携しているか？
設計とruntime implementationは一致しているか？
```

これらを個別の図を手作業で同期するのではなく、
独立したcanonical artifacts + Architecture Graphからprojectionできる状態を目指す。

## Open questions

- SemanticEntity identityをartifact固有IDだけで十分とするか、Studio側immutable IDも持つか
- semantic address URIのformal syntax
- relationship type vocabularyをどこまで標準化するか
- authored relationの保存場所をworkspace metadataとするかsidecar fileとするか
- Bonita BDM以外のdata-model formatsを追加した際に、SemanticEntity exposure contractをどこまで共通化するか
- JSON Schema等とのentity/field identity mapping
- BPMN extension elementへsemantic refsを埋め込むかsidecarにするか
- OPA ASTからどの粒度までdependencyを安全に抽出できるか
- n8n expression/node mappingからfield-level lineageをどこまで推論するか
- OpenLineageとのimport/export boundary
- architecture rule validationをOPAで統一するか独立rule APIを用意するか
