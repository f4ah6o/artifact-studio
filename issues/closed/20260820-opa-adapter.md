# OPA Adapter 実装プロポーザル

Status: open
Date: 2026-08-20
Target: Artifact Studio

## Goal

Artifact Studio に Open Policy Agent (OPA) / Rego を扱う汎用 adapter を追加する。

この adapter は、特定の業務ドメインの Policy を扱うものではなく、OPA/Rego artifact の編集・検証・評価・テスト・分析・可視化を行うための workbench とする。

```text
Rego / data / input / bundle
  -> import / edit
  -> validate
  -> evaluate / test
  -> analyze
  -> visualize
  -> persist
  -> export
```

Artifact Studio の public repository には、業務役割管理、組織、任命、kintone 等のドメイン固有概念を持ち込まない。

## Design boundary

### Artifact Studio が知るもの

OPA/Rego の一般概念のみを扱う。

- Rego source
- package
- rule
- import
- `input`
- `data`
- entrypoint
- bundle / workspace
- evaluation result
- test result
- diagnostics
- dependency
- explanation / trace
- coverage

### Artifact Studio が知らないもの

以下は adapter 本体にハードコードしない。

- 事務業務責任者、施工業務責任者等の特定役割
- 任命・選任等の社内制度
- 組織階層
- 案件役割
- kintone field / app ID
- 特定会社の Policy schema
- 特定業務用 YAML -> Rego 変換規則

これらが必要な利用側では、別 repository / extension / generated OPA bundle で扱う。

```text
Domain policy source
  -> domain-specific compiler / generator
  -> Rego + data
  -> Artifact Studio OPA adapter
```

## Canonical artifact

OPA は単一 `.rego` ファイルだけで完結しないため、canonical artifact は単一 source string ではなく **OPA workspace** とする。

概念モデル:

```ts
interface OpaWorkspace {
  files: Record<string, string>;
  entrypoints?: string[];
  activeFile?: string;
  inputFile?: string;
}
```

例:

```text
policy/
  authz.rego
  assignment.rego
  data.yaml
  input.json
```

単一 `.rego` の import も workspace の1ファイルとして扱う。

### Artifact Studio の一般化

現状の adapter / persistence は単一 `source` を中心に設計されているため、OPA adapter のためだけの例外実装にはしない。

必要であれば Artifact Studio の artifact contract を以下のように一般化する。

```ts
type ArtifactContent =
  | { kind: 'text'; source: string }
  | { kind: 'workspace'; files: Record<string, string> };
```

この workspace abstraction は OPA 以外の multi-file artifact でも再利用可能な設計にする。

## Adapter capabilities

概念的には以下を提供する。

```ts
interface OpaAdapter {
  id: 'opa';

  import(sourceOrFiles: unknown): Promise<OpaWorkspace>;
  validate(workspace: OpaWorkspace): Promise<ValidationResult>;
  format(workspace: OpaWorkspace): Promise<OpaWorkspace>;
  serialize(workspace: OpaWorkspace): Promise<SerializedArtifact>;

  evaluate(
    workspace: OpaWorkspace,
    query: string,
    input?: unknown,
  ): Promise<EvaluationResult>;

  test(workspace: OpaWorkspace): Promise<TestResult>;
  analyze(workspace: OpaWorkspace): Promise<OpaAnalysis>;
}
```

既存 adapter contract に OPA 固有メソッドを直接増やしすぎず、必要なら generic action/capability API を導入する。

例:

```ts
capabilities: {
  validate: true,
  format: true,
  actions: ['evaluate', 'test', 'coverage', 'dependencies'],
  views: ['source', 'dependencies', 'decision', 'tests'],
}
```

## Execution architecture

OPA の意味論を JavaScript で再実装しない。

OPA公式実装を実行系の authority とする。

初期実装では、Artifact Studio の server/backend から `opa` CLI を実行する方式を第一候補とする。

想定コマンド相当:

- `opa check`
- `opa fmt`
- `opa eval`
- `opa test`
- dependency / inspection 系 CLI
- coverage / explanation 出力

ブラウザのみで完結させるために独自 evaluator を実装しない。
WASM 利用は、CLI版との意味論・機能差と保守コストを評価した上で別途判断する。

### Security

OPA CLI 呼び出しは arbitrary shell command を組み立てず、固定 argv と一時 workspace を使う。

- client supplied path をそのまま filesystem path にしない
- path traversal を拒否
- workspace ごとに一時ディレクトリを分離
- command / option allowlist
- timeout
- stdout/stderr size limit
- symlink を artifact として扱わない

## Validation

### Structural

- workspace file path validity
- supported text encoding
- duplicate/colliding paths
- JSON / YAML parse validity

### Rego validation

OPA公式 evaluator / compiler を使う。

- syntax error
- compile error
- unsafe variable
- import/package error
- type/check diagnostics where available

結果は Artifact Studio 共通 findings UI に変換する。

```ts
interface Finding {
  severity: 'error' | 'warning' | 'info';
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  message: string;
}
```

## Formatting

Rego formatting は OPA公式 formatter を authority とする。

- `.rego`: OPA formatter
- `.json`: deterministic JSON formatting
- `.yaml` / `.yml`: content-preserving generic formatter がある場合のみ

format 操作で意味を変更しない。

## Views

初期版では、OPAの意味論から一般的に導出できるビューのみ提供する。

### 1. Source view

- workspace tree
- Rego editor
- data/input editor
- diagnostics

### 2. Dependency graph

package / rule / `data` / `input` の依存を graph として表示する。

例:

```text
input
  -> allow
      -> active_user
      -> data.permissions
```

描画は既存 Mermaid adapter / renderer を再利用できる場合は再利用する。

重要: Mermaid source は projection であり canonical artifact ではない。

```text
OPA workspace
  -> OPA analysis
  -> generic graph projection
  -> Mermaid renderer
```

### 3. Decision Explorer

query + input に対する評価結果と explanation を読みやすく表示する。

例:

```text
allow = false

relevant evaluation
  active_user       true
  has_permission    true
  scope_matches     false
```

OPAの実際の explanation / trace 情報を基に表示し、Artifact Studio側で存在しない因果関係を推測しない。

### 4. Tests / Coverage

- test pass/fail
- failing test detail
- coverage summary
- uncovered rules/locations where取得可能

を表示する。

## Projection API

OPA adapter 実装で Mermaid 専用データを直接生成するのではなく、可能なら Artifact Studio 共通の graph projection を導入する。

```ts
interface GraphProjection {
  nodes: Array<{
    id: string;
    label: string;
    kind?: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label?: string;
    kind?: string;
  }>;
}
```

renderer は projection を Mermaid 等へ変換する。

これにより将来の adapter でも graph viewer を再利用できる。

## UI

Header adapter selector に `OPA` を追加する。

OPA adapter 選択時の基本UI:

```text
[workspace/files] [source editor]

View:
  Source
  Dependencies
  Decision
  Tests

Actions:
  Format
  Validate
  Evaluate
  Test
```

Decision view では少なくとも以下を指定可能にする。

- query / entrypoint
- input JSON/YAML

評価結果・diagnostics は source と切り離さず同じ workspace に紐付けて表示する。

## Persistence

OPA workspace を Artifact Studio workspace envelope に保存・復元できること。

multi-file artifact の保存形式は OPA 固有にせず、Artifact Studio の generic workspace artifact として設計する。

大容量化する場合は既存設計方針に従い IndexedDB を検討する。

評価結果・test結果は canonical artifact には含めない。
必要なら derived/cache metadata として扱う。

## Import / Export

初期対象:

- 単一 `.rego`
- 複数ファイル workspace
- `.rego` + JSON/YAML data/input

bundle archive の import/export は、既存 Artifact Studio の file handling と security boundary を確認して次段階で追加してよい。

## AI assistance

AI に Rego を生成・編集させる場合でも、生成結果は必ず OPA公式 validation を通す。

```text
prompt
  -> generated Rego/workspace
  -> opa format
  -> opa check
  -> optional tests
  -> artifact accepted
```

AIに独自のOPA互換性判定をさせない。

初期版で domain-specific prompt template は Artifact Studio 本体に入れない。

## Out of scope

初期版では以下を行わない。

- 業務役割管理用 schema
- kintone連携
- role / organization matrix
- YAML business DSL -> Rego compiler
- OPA server deployment
- bundle publishing
- authorization middleware
- Kubernetes/Gatekeeper専用UI
- Terraform専用UI
- full debugger の再実装
- JavaScriptによるRego evaluator再実装

## Implementation order

1. adapter contract の multi-file/workspace 対応を設計・テスト
2. OPA adapter registry entry と基本UI
3. workspace import/edit/persist/export
4. server-side OPA execution abstraction
5. `format` / `check`
6. `eval`
7. `test`
8. common findings mapping
9. dependency graph projection
10. Decision Explorer
11. tests / coverage view
12. documentation / compatibility tests

BPMN / Mermaid の既存動作を壊さないことを各段階で確認する。

## Acceptance criteria

- [ ] Header selector から OPA adapter に切替できる
- [ ] 単一 Rego と multi-file OPA workspace を扱える
- [ ] workspace を保存・復元できる
- [ ] Rego を OPA公式 formatter で整形できる
- [ ] OPA公式 compiler による validation diagnostics を表示できる
- [ ] query + input を指定して `eval` できる
- [ ] `opa test` 相当を実行し pass/fail を表示できる
- [ ] dependency graph を表示できる
- [ ] evaluation explanation を Decision Explorer で確認できる
- [ ] BPMN / Mermaid adapter の既存テスト・demo が回帰しない
- [ ] Artifact Studio 本体に業務役割・組織・kintone固有ロジックが入っていない
- [ ] OPA CLI invocation に path traversal / arbitrary command injection がない

## Open questions

- OPA CLI を必須外部依存にするか、管理されたbinary配布を行うか
- browser-only mode のための OPA WASM を将来提供するか
- workspace artifact contract をどこまで generic core に昇格させるか
- dependency graph の情報源を CLI output / AST / inspection API のどれにするか
- explanation のどの粒度を初期 Decision Explorer に表示するか
- bundle archive import/export を初期版に含めるか

## Non-goal / architectural rule

この issue の目的は「業務PolicyをArtifact Studioに実装すること」ではない。

目的は **OPA/RegoをArtifact Studioの汎用artifact typeとして第一級に扱えるようにすること** である。

特定業務で OPA を利用する際は、そのドメイン固有 source / compiler / schema を別レイヤーに置き、Artifact Studio は生成済み OPA artifact を扱う。

## Completion evidence — 2026-08-20

Implemented and verified on `main` via PR #3 / `9ab4835` and follow-up Vite+ migration / live compatibility fix `b18b3aa`.

Evidence:

- OPA is selectable as a first-class adapter in the shared header registry.
- Generic artifact content persistence supports both text and multi-file workspace content.
- Single Rego files and multi-file OPA workspaces can be imported, edited, persisted, restored, and exported.
- Server-side OPA execution uses fixed argv and a bounded temporary workspace; unsafe paths are rejected before invocation.
- Official OPA CLI is the authority for format, check, eval, test, and dependency analysis.
- OPA diagnostics are mapped into the common findings model.
- Dependency analysis is projected into generic graph-shaped data and rendered without making Mermaid the canonical artifact.
- Current OPA v1.19.1 was exercised live for check / eval / test / deps. The live deps schema (`base` / `virtual` term arrays) is supported, with legacy aliases retained for compatibility.
- BPMN and Mermaid regression suites remained green.
- Vite+ test suite: 364 passed, 1 skipped; `vp check` exited 0; `vp build` succeeded; demo / proxy smoke checks succeeded.

The remaining ideas in this proposal (richer coverage UI, deeper Decision Explorer, managed OPA binary distribution, browser-only WASM, bundle publishing) are optional future enhancements rather than blockers for the adapter being production-usable. They should be tracked separately if promoted to concrete work.

## Status

Closed: the OPA adapter is implemented and live-verified. Further cross-adapter generalization belongs to the composition / projection architecture issues rather than this adapter issue.
