# Artifact lifecycle と Desktop runtime の再設計

- Status: closed — browser lifecycle and host boundary implemented; desktop packaging deferred
- Date: 2026-08-21
- Scope: As-Code Studio shell / workspace / local runtime

## Completion status

2026-08-21 時点で、このissueのうち desktop packaging 以前に必要だった application boundary は実装済み。

- human-readable Artifact title / selector
- rename / delete
- semantic-empty Artifact reuse / duplicate empty cleanup
- stable lifecycle timestamps and lineage-safe delete
- storage objectを差し替え可能な `ArtifactWorkspaceStore` boundary
- browser HTTPを実装詳細へ隔離した `HostRuntime` boundary
- OPA / Dagu / Bonita BDM client runtimeの `HostRuntime` 利用

Electron / Tauri application自体は実装していない。これは当初からこのissueのnon-goalであり、必要になった時点でdesktop host固有issueとして改めて扱う。

## 背景

As-Code Studio の Artifact Workspace v2 では、同じ adapter について複数の Artifact を保持できる。
UI には adapter selector と artifact selector と `New Artifact` がある。

現状、`New Artifact` を押すたびに localStorage の workspace に新しい Artifact record が追加される。
Artifact には人間向けの名前がなく、selector では adapter 名 + artifact ID の一部だけが表示されるため、何が何か分からなくなりやすい。

さらに LAN 上の HTTP (`http://192.168.x.x:5173`) で開いている場合、secure context ではないため `crypto.randomUUID()` が利用できず、fallback の時刻ベース ID が使われる。
UI は ID の先頭側だけを短縮表示しているため、複数 Artifact が同じような表示になり、増殖しているように見える。

## 現在の問題

### 1. Artifact lifecycle が UI 上で不明確

- adapter の切替と artifact の切替が並んでいるが役割が分かりにくい。
- `New Artifact` が永続的な新規ドキュメント作成であることが分かりにくい。
- 空 Artifact でも即座に永続化される。
- 削除 UI がない。
- rename がない。
- 人間向け title/name がない。
- adapter ごとの「既定 Artifact」と「明示的に作った複数 Artifact」の区別がない。

### 2. Artifact ID の表示が識別用途に向いていない

- ID は内部識別子であり、UI の主表示に使うべきではない。
- 非 secure context では UUID fallback が時刻ベースになる。
- 短縮位置が先頭側なので collision-like な見え方になる。

### 3. Browser + LAN HTTP runtime の制約

現在の dev/runtime は browser UI + local HTTP server であり、以下が分離している。

- UI: browser
- persistence: browser localStorage
- local CLI: Node server 経由
- Codex app-server: local process
- Dagu / OPA 等: local CLI

この構成では、ローカルファイル・CLI・workspace の概念が browser origin に依存しやすい。
As-Code Studio は実態として「ローカル開発ツール / desktop workbench」に近くなっている。

## 期待する Artifact lifecycle

### Artifact identity

Artifact record に少なくとも以下を持つ。

- stable internal id
- adapterId
- human-readable title
- content
- createdAt
- updatedAt
- optional lineage

内部 ID は UI の主表示にしない。

### UI

- adapter selector: Artifact type / capability を選択する。
- artifact selector: 既存 Artifact を title で選択する。
- `New Artifact`: 明示的な新規作成。
- rename を提供する。
- delete を提供する。
- empty artifact は、ユーザーが編集を開始するまで永続化しない案を検討する。
- selector の補助情報として adapter と短い ID を表示する場合でも、title を主とする。

### cleanup

既に workspace 内に生成された空または不要な Artifact を整理できること。

## Desktop application 化の検討

As-Code Studio を Electron または Tauri の desktop app とし、CLI / Codex はローカル process として動かす案を検討する。

### Desktop 化で改善できる点

- browser origin / LAN HTTP に persistence が依存しなくなる。
- UUID / secure-context 問題を host 側で解消できる。
- workspace を localStorage ではなく app data / project file として保存できる。
- Dagu / OPA / Codex 等の local CLI を app host から直接 spawn できる。
- local file open/save を desktop app の標準機能として扱える。
- localhost API server を必須にしない構成を選択できる。
- 将来的に project/workspace 単位で directory を開く UX に寄せやすい。

### Desktop 化しても自動では解決しない点

- `New Artifact` の意味
- Artifact の rename/delete
- 空 Artifact の作成ルール
- workspace の lifecycle
- lineage と derived Artifact の扱い

これらは application model の問題であり、Electron/Tauri に変えるだけでは直らない。

## Electron と Tauri の比較方針

### Electron

既存実装との距離が短い。

- main process が Node.js なので現在の Node server / CLI spawn / Codex app-server integration を再利用しやすい。
- current HTTP API を IPC に置き換えるか、main process 内 service として呼び出せる。
- MVP desktop 化には最も低リスク。

欠点:

- Chromium + Node を同梱するためサイズ・メモリ負荷が大きい。

### Tauri

local CLI を host から spawn する構成自体は適合する。

- shell/sidecar で `codex`, `dagu`, `opa` 等を起動可能。
- filesystem を app data / project directory に寄せやすい。
- distribution が比較的軽い。

ただし現在の Node 側 backend をそのまま main process として使えない。

選択肢:

1. Node backend を sidecar として残す。
2. host boundary を Rust command に移す。
3. browser-safe な TS core は frontend/shared に残し、Node-specific process/file operations だけ Rust host に移す。

2/3 は設計としてきれいだが、Electron より移行コストが高い。

## 推奨方針

短期:

1. まず browser版の Artifact lifecycle を修正する。
2. workspace persistence を localStorage 固定から repository/interface 化する。
3. CLI / filesystem / process spawning を host service interface として分離する。

その後:

- 最小の desktop 化を優先するなら Electron。
- 長期的に小さな配布物と明確な host capability boundary を重視するなら Tauri。

現在のコードを直接 Tauri 化するより、先に `ArtifactStore` / `HostRuntime` の境界を作ることを優先する。

## Proposed architecture

```text
As-Code Studio UI
  |
  +-- ArtifactWorkspace
  |     +-- ArtifactStore
  |           +-- BrowserStore (dev / fallback)
  |           +-- DesktopStore (app data / project files)
  |
  +-- HostRuntime
        +-- runCodex()
        +-- runDagu()
        +-- runOpa()
        +-- readFile()/writeFile()
        +-- selectFile()/selectDirectory()

Browser dev host
  -> HTTP implementation

Electron host
  -> Node/IPC implementation

Tauri host
  -> Rust command / shell / fs implementation
```

## Acceptance criteria

- [x] Artifact selector の主表示が human-readable title になる。
- [x] Artifact を rename できる。
- [x] Artifact を delete できる。
- [x] 空 Artifact が意図せず増殖しない。
- [x] internal ID が browser secure-context の有無に UI 品質を左右されない。
- [x] Artifact persistence が storage implementation を差し替え可能な boundary を持つ。
- [x] CLI / filesystem/process access を UI から直接固定せず `HostRuntime` abstraction 経由にできる。
- [x] Electron/Tauri のどちらにも載せ替えられる host boundary を定義する。

## Non-goals

- Dagu Web UI の再実装。
- Codex CLI 自体の置き換え。
- OPA/Dagu の runtime semantics の再実装。
- この issue の段階で Electron/Tauri のどちらかに即時固定すること。

## Closure evidence

Primary implementation child: `issues/closed/20260821-artifact-workspace-lifecycle-host-boundary.md`. Full regression suite and production build remained green after subsequent Bonita BDM and As-Code Studio rename work.
