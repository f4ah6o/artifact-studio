# Codex Artifact Session / Model / Effort Controls

Status: closed
Date: 2026-08-20
Target: As-Code Studio app server / Web UI
Related:
- `docs/ai-assisted-modeler.md`
- `docs/ai-assisted-modeler.ja.md`
- `scripts/agents/codex-app-server-provider.js`
- `scripts/http-server.js`

## Goal

Codex app-server integration を `1 request = 1 thread` の stateless MVP から、**Artifact / work session 単位で適度に継続する AI session** へ進める。

同時に、Codex app-server が提供する model catalog を authority として、現在利用している model / reasoning effort を UI に表示し、対応範囲内で次の turn から切り替えられるようにする。

Artifact の canonical content / semantic model と Codex runtime session metadata は明確に分離する。

## Current state

現在の `CodexAppServerClient.runTurn()` は呼び出しごとに `thread/start` を実行してから `turn/start` を実行する。

そのため:

- chat / discovery / generation / review の文脈が Codex thread として継続されない
- frontend の message history 再送に依存した擬似的な継続になりやすい
- orchestrate 等の別 AI operation と同じ work context を共有しにくい
- 長い作業ほど prompt 再投入量が増える

model / effort については provider 側に既に以下の入力経路がある。

- `CODEX_MODEL`
- `CODEX_EFFORT`（default: `medium`）
- `thread/start.model`
- `turn/start.model`
- `turn/start.effort`

一方 UI は `CODEX_MODEL` が環境変数で指定された場合だけ model 名を表示し、effort は表示しない。model / effort の UI 切替もない。

現行 Codex app-server protocol には `model/list` があり、model ごとに少なくとも次を取得できる。

- `id`
- `model`
- `displayName`
- `description`
- `isDefault`
- `defaultReasoningEffort`
- `supportedReasoningEfforts`

よって As-Code Studio 側で model 名や effort 候補をハードコードしない。

## Design principles

### 1. Session lifetime is Artifact/work-session scoped

1本の Codex thread を user 全体で永久共有しない。

基本境界:

```text
Artifact A
  └─ AI work session A
      └─ Codex thread A
          ├─ discovery
          ├─ grilling
          ├─ generate
          ├─ review
          └─ refinement

Artifact B
  └─ AI work session B
      └─ Codex thread B
```

同じ Artifact を同じ作業目的で編集している間は thread を継続する。

新しい Artifact、明示的な new AI session、文脈を切るべき大きな目的変更では新しい thread を開始する。

### 2. Thread id is runtime metadata, not artifact semantics

`threadId` / selected model / effort 等を BPMN / Mermaid / OPA 等の canonical artifact content に混ぜない。

概念的には次のような shell/runtime metadata とする。

```ts
interface AiWorkSession {
  artifactSessionId: string;
  codexThreadId: string | null;
  model: string | null;
  effort: string | null;
}
```

命名・永続化形式は既存 persistence architecture に合わせて実装時に確定する。

### 3. Resume first, reset explicitly

同じ Artifact work session では既存 thread を resume / continue する。

最低限 UI に以下の操作を持つ。

- current AI session の状態表示
- new AI session / reset context

fork は app-server contract と UX の必要性を確認し、初期実装の必須要件にはしない。

### 4. Codex model catalog is the authority

model selector は `model/list` の結果から生成する。

- hidden model は通常 UI に出さない
- `isDefault` を default indication に利用する
- model を変更したら、その model の `supportedReasoningEfforts` から effort selector を再構成する
- unsupported effort を送らない
- model ごとの `defaultReasoningEffort` を利用する

As-Code Studio 側に `low / medium / high / ultra` 等の固定リストを authority として持たない。

### 5. Selection affects subsequent turns

model / effort の変更のために Codex app-server process を再起動しない。

現在の session context を保ちながら、次の turn 以降へ model / effort override を渡す。

app-server の thread settings API を利用する方が semantics 上適切なら、現行 schema を確認した上でそちらを利用してよい。ただし `config.toml` を UI 操作のたびに書き換える設計にはしない。

### 6. Environment variables remain bootstrap/default inputs

`CODEX_MODEL` / `CODEX_EFFORT` は headless / deployment 用 default として残してよい。

ただし UI runtime の選択状態と混同しない。

優先順位は実装時に明示し、最低限以下を deterministic にする。

```text
explicit work-session selection
  > configured environment default
  > app-server advertised default
```

実際の app-server default semantics と矛盾する場合は protocol の authority を優先し、test で固定する。

## Proposed API surface

具体的な route 名は既存 API 命名に合わせて変更可。最低限 frontend が以下を取得できる surface を用意する。

### Codex status/catalog

```json
{
  "available": true,
  "authenticated": true,
  "accountType": "...",
  "planType": "...",
  "models": [
    {
      "id": "...",
      "model": "...",
      "displayName": "...",
      "isDefault": true,
      "defaultReasoningEffort": "medium",
      "supportedReasoningEfforts": [
        { "reasoningEffort": "medium", "description": "..." }
      ]
    }
  ]
}
```

API は provider credential / token / secret を返さない。

### AI operation request

chat / orchestrate / artifact generation 等が同じ work session identity を渡せるようにする。

例:

```json
{
  "aiSessionId": "...",
  "model": "...",
  "effort": "..."
}
```

frontend が raw Codex `threadId` を authority として自由入力する形にはしない。server 側 session metadata から Codex thread を解決する。

## Provider changes

`CodexAppServerClient` を、既存 thread の継続を表現できる API にする。

概念例:

```ts
runTurn(text, {
  threadId,
  model,
  effort,
  ...
})
```

- `threadId == null` なら thread を開始する
- 既存 thread があれば同一 thread で次 turn を開始する
- response は確定した `threadId` を返す
- stale / unavailable thread の error handling を明示する
- silent に別 thread へ落とす場合は context loss を frontend / telemetry から識別可能にする

app-server が resume API を要求する場合は、その protocol semantics に従う。

## UI

接続状態の横または AI controls 内に、少なくとも次を表示する。

```text
Codex: 接続済み / <plan>
Model:  [ <display name> ▼ ]
Effort: [ <supported effort> ▼ ]
Session: 継続中
[New AI session]
```

Requirements:

- model 未明示でも app-server advertised default を表示できる
- effort を現在値として表示する
- model change に応じて effort options が更新される
- unsupported combination を選べない
- catalog loading / auth failure 時は AI controls を安全に disable する
- Artifact 切替時は対応する AI work session へ切り替える
- session reset は artifact content を変更しない

## Persistence boundary

ページ reload 後も同じ Artifact の作業を自然に継続できることを目標とする。

ただし Codex app-server 側で thread が既に失効・削除されている場合は、新しい thread を開始して session metadata を更新できること。

永続化するのは必要最低限の参照情報とし、Codex conversation transcript を As-Code Studio 側に二重保存することは本 issue の目的にしない。

## Security / privacy

- Codex auth token / provider credentials を browser に渡さない既存方針を維持する
- arbitrary `threadId` injection を許可しない
- unrelated Artifact / user context を同一 thread に multiplex しない
- shared central deployment では user isolation が成立するまで current single-user/local assumption を維持する
- model catalog は account が利用可能な範囲を app-server から取得し、server が勝手に capability を拡張しない

## Scope boundary

今回やらないもの:

- Artifact canonical model への conversation history 埋め込み
- project 全体で永久共有する global Codex thread
- provider-independent universal LLM settings framework
- `config.toml` editor
- model / effort list の手動ハードコード
- multi-user central deployment の auth/session isolation 全体
- token/cost accounting UI
- autonomous model routing / automatic effort optimization

## Implementation order

1. current app-server schema/version contract を test fixture または protocol adapter test で固定する。
2. `model/list` client method と model catalog normalization を追加する。
3. current/default model + supported effort の server API を追加する。
4. provider を existing thread continuation 対応へ変更する。
5. server-side `AiWorkSession` mapping を導入し、Artifact/work-session identity と threadId を関連付ける。
6. `/chat`, `/orchestrate`, artifact AI generation を同じ session mapping から Codex provider へ流す。
7. frontend に model / effort selector と session status/reset を追加する。
8. reload / Artifact switch / stale thread / model switch の tests を追加する。
9. docs の `1 request = 1 thread` に相当する説明を新 contract に更新する。

## Acceptance criteria

- [x] 同じ Artifact work session の連続 AI operation が同一 Codex thread を利用する。
- [x] 別 Artifact の AI operation が意図せず同一 thread を共有しない。
- [x] new AI session 操作で context を明示的に切れる。
- [x] page reload 後、利用可能な既存 thread を継続できる。
- [x] stale / unavailable thread を deterministic に回復でき、context reset が観測可能である。
- [x] `model/list` から利用可能 model を取得し UI に表示する。
- [x] model 未指定時も advertised/default model を UI で識別できる。
- [x] selected model の `supportedReasoningEfforts` のみ effort selector に表示する。
- [x] current model / effort が UI に表示される。
- [x] model / effort の変更が app-server process 再起動なしで次の turn に反映される。
- [x] `CODEX_MODEL` / `CODEX_EFFORT` の bootstrap behavior が regression しない。
- [x] raw provider credentials / auth token / unrelated thread metadata を browser に露出しない。
- [x] canonical artifact content に Codex thread/session metadata を混ぜない。
- [x] chat / orchestrate / artifact generation が同じ AI work-session contract を共有する。
- [x] relevant unit/integration tests と `vp check`, `vp test --run`, `vp build` が green。
- [x] completion evidence を追記して `issues/closed/` に移せる。

## Completion evidence

2026-08-20 implementation completed on `main`.

### Codex app-server protocol evidence

- The installed Codex app-server schema was generated with `codex app-server generate-json-schema --experimental` before implementation.
- `model/list` is confirmed to return paginated `{ data, nextCursor }` model catalog entries with `id`, `model`, `displayName`, `hidden`, `isDefault`, `defaultReasoningEffort`, and `supportedReasoningEfforts`.
- `thread/resume` is the protocol operation for continuing a persisted thread by `threadId`; the current schema explicitly says to prefer `threadId` when possible.
- `turn/start.model` and `turn/start.effort` are confirmed by the current schema to override the current and subsequent turns, so UI changes do not require restarting app-server.
- A live missing-thread probe returned `no rollout found for thread id ...`; only this stale/unavailable-thread class is treated as recoverable. Authentication and unrelated app-server failures are not silently converted into context resets.
- A live `model/list` probe returned six visible models in the current account; the advertised default at verification time was `gpt-5.6-sol` with default reasoning effort `low`. As-Code Studio does not hard-code those values.

### Implementation evidence

- `CodexAppServerClient` now supports catalog pagination, `thread/resume`, continued turns, model/effort overrides, and observable stale-thread recovery.
- `AiWorkSessionStore` keeps the provider `threadId` server-side and exposes only an opaque Artifact work-session id plus safe model/effort/reset state to the browser.
- Browser workspace persistence stores per-Artifact AI work-session identity and model/effort selection separately from canonical BPMN/Mermaid content. Reloading the page reuses the same work-session id; switching Artifact adapters resolves a different work session; replacing artifact content starts a new work-session id.
- `/chat`, `/orchestrate`, and Mermaid AI generation use the same work-session contract. Frontend chat history is no longer resent as pseudo-session context; Codex thread continuation is the conversation authority.
- Model and effort selectors are populated from `model/list`; changing model rebuilds effort choices from that model's advertised supported efforts and falls back to its advertised default effort.
- `New AI session` clears only Codex runtime context. It does not mutate canonical artifact content.
- Raw Codex thread ids, auth tokens, and provider credentials are never returned to the browser.

### Regression evidence

- `vp check`: exit 0, 0 errors. Existing repository lint warnings remain non-blocking.
- `vp test --run`: 14 test files passed, 1 skipped; 383 tests passed, 1 skipped.
- `vp build`: green; 2467 modules transformed and production frontend bundle generated successfully.
- `git diff --check`: green.
- Added deterministic fake app-server protocol coverage for model catalog pagination, thread continuation, next-turn model/effort changes, stale-thread recovery, session isolation, reset semantics, and safe public session state.

