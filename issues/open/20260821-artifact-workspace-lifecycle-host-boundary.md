# Artifact workspace lifecycle と host boundary を整理する

- Status: open
- Date: 2026-08-21
- Scope: Artifact Studio shell / workspace / browser host runtime
- Parent: `issues/open/20260821-artifact-lifecycle-and-desktop-runtime.md`

## 背景

Artifact Workspace v2 で同一 adapter の複数 Artifact を保持できるようになった一方、現在の UI は internal artifact ID を主な識別情報として表示し、`New Artifact` は空の Artifact record を即時永続化する。

その結果、ユーザーから見ると `BPMN · 17872881` のような識別不能な項目が増え、Artifact selector が履歴一覧のように見える。

また client code は `localStorage` と HTTP endpoint を直接参照しており、Artifact Store と local CLI/Codex を提供する host runtime の境界が明確でない。

Electron/Tauri 化は別途検討する。本 issue では desktop framework は導入せず、その前提となる application model と host boundary を整える。

## Goals

### 1. Human-readable Artifact identity

Artifact record に以下を持たせる。

- stable internal `id`
- `adapterId`
- human-readable `title`
- `createdAt`
- `updatedAt`
- `content`
- optional `lineage`

internal ID は selector の主表示に使わない。

### 2. Artifact lifecycle UI

- Artifact selector は `title` を主表示とする。
- rename を提供する。
- delete を提供する。
- `New Artifact` 連打で空 Artifact が増えない。
- 空 Artifact が既にある場合は再利用する。
- 既存 workspace にある重複した空 Artifact を安全に整理できる。
- lineage の source として参照されている Artifact の削除は fail closed にする。

### 3. Artifact Store boundary

UI から `localStorage` を直接渡す処理を減らし、workspace repository/store を application boundary とする。

Browser persistence は引き続き Web Storage を使用してよいが、UI は store API 経由で操作する。

### 4. HostRuntime boundary

client からの HTTP `fetch()` を `HostRuntime` abstraction に集約する。

Browser dev runtime は HTTP implementation を提供する。

最低限以下を host runtime 経由にする。

- app config
- AI/Codex API
- BPMN API
- adapter action API (OPA / Dagu)

将来 Electron/Tauri など別 host を選ぶ場合でも UI/adapter extension 側を HTTP 固定にしない。

## Artifact title policy

新規 Artifact は adapter label を基準に連番 title を生成する。

例:

- `BPMN 1`
- `Dagu 1`
- `Dagu 2`
- `OPA / Rego 1`

既存 v2 / legacy Artifact に title がない場合は migration/normalization で安定した fallback title を付与する。

derived Artifact は可能なら source title と transform 文脈を引き継ぐ。最低限 adapter-based title を持たせる。

## Empty Artifact policy

`New Artifact` 実行時、現在の adapter に未使用の empty Artifact が既に存在する場合は新規 record を作らず、その Artifact を選択して再利用する。

empty 判定:

- text: `source.trim() === ''`
- workspace: file がない、または全 file content が空

自動 cleanup は以下に限定する。

- content が empty
- lineage がない
- relationship で参照されていない
- adapter ごとに最低1件は残す

非空 Artifact は自動削除しない。

## Delete policy

削除対象が以下に該当する場合は削除を拒否する。

- 他 Artifact の `lineage.derivedFrom` から参照されている

Artifact に直接接続する relationship は Artifact 削除時に cleanup する。

削除後は同 adapter の別 Artifact、なければ workspace 内の別 Artifactを active にする。

## HostRuntime

初期 Browser implementation:

```text
UI / adapter extensions
        |
        v
    HostRuntime
        |
        v
 BrowserHttpHostRuntime
        |
        v
 /api/v1/*
        |
        +-- Codex app-server
        +-- Dagu CLI
        +-- OPA CLI
```

この issue では Electron/Tauri implementation は作らない。

## Acceptance criteria

- [ ] Artifact record が `title`, `createdAt`, `updatedAt` を持つ。
- [ ] 既存 workspace を読み込んでも title が欠落しない。
- [ ] Artifact selector は internal ID ではなく title を主表示する。
- [ ] rename できる。
- [ ] delete できる。
- [ ] lineage source Artifact の削除は拒否される。
- [ ] `New Artifact` 連打で空 Artifact が増えない。
- [ ] 安全な重複 empty cleanup が実装される。
- [ ] `src/client/main.js` が Artifact操作のために `localStorage` を直接渡さない。
- [ ] client の OPA / Dagu / shell API call が HostRuntime 経由になる。
- [ ] existing transforms / lineage semantics を壊さない。
- [ ] tests / format / build が通る。

## Non-goals

- Electron application の実装。
- Tauri application の実装。
- desktop installer / updater。
- Dagu runtime Web UI の再実装。
- OPA/Dagu/Codex CLI 自体の置き換え。
