# Bento.page Adapter 実装構想

Status: open
Date: 2026-08-20
Target: Artifact Studio

## Goal

Artifact Studio から Bento.page の portable presentation/document を生成・編集・検証・保存・書き出しできる adapter を追加する。

BPMN や Mermaid と同様に、AI 生成そのものではなく以下の共通ライフサイクルへ載せる。

```text
prompt / import
  -> canonical source
  -> validate
  -> preview / edit
  -> persist
  -> export
```

## Canonical artifact

Bento の `.bento.html` を canonical artifact とする。

Bento は単一 HTML 内に `application/bento+json` の構造化データを持てるため、Artifact Studio 側で独自の中間 presentation schema を新設するより、Bento の document format を直接扱う方針とする。

内部では次の2表現を区別する。

- `source`: 完全な `.bento.html`
- `model`: HTML 内から抽出した Bento JSON

保存・export の canonical source は `.bento.html`。
AI 編集・validation は Bento JSON を主対象とする。

## Adapter capabilities

```ts
interface BentoAdapter {
  id: 'bento';
  import(source: string): BentoDocument;
  generate(prompt: string): Promise<BentoDocument>;
  validate(document: BentoDocument): ValidationResult;
  format(document: BentoDocument): BentoDocument;
  render(document: BentoDocument, host: HTMLElement): Promise<void>;
  serialize(document: BentoDocument): string;
  exportFileName(): string; // presentation.bento.html
}
```

## UI

- Header adapter selector に `Bento` を追加
- 左または中央に Bento JSON / document source editor
- preview は sandboxed iframe で表示
- `AIで生成`
- `検証`
- `整形`
- `.bento.html を開く`
- `.bento.html を書き出す`

Bento 自身の editor を埋め込める場合は、独自 editor を作り込まず Bento editor を優先する。

## AI generation

専用 endpoint を追加する。

```text
POST /api/v1/artifacts/bento/generate
```

入力:

```json
{
  "userText": "..."
}
```

出力:

```json
{
  "status": "success",
  "source": "<!doctype html>...",
  "model": {}
}
```

Codex には完全 HTML を自由生成させず、可能なら Bento JSON のみ生成させ、template shell への埋め込みは deterministic code で行う。

## Validation

最低限:

- `.bento.html` として parse 可能
- `script[type="application/bento+json"]` が1個存在
- JSON parse 成功
- Bento が要求する top-level shape
- asset / URL の安全性
- script injection を許さない

Bento の正式 schema が利用可能なら JSON Schema validation に置き換える。

## Security

Bento は HTML artifact のため BPMN / Mermaid より強い隔離が必要。

- preview は sandboxed iframe
- raw HTML を親 document に `innerHTML` しない
- external scripts は原則禁止
- `javascript:` URL 禁止
- import 時に active content を検査
- AI が生成した任意 script を実行しない

## Persistence

Artifact Studio workspace storage を利用する。

```json
{
  "adapter": "bento",
  "source": "...bento.html...",
  "updatedAt": "..."
}
```

ファイルサイズが localStorage の現実的上限を超える場合は IndexedDB adapter へ移行する。

## Open questions

- Bento editor を公式に embed できる安定 API があるか
- `.bento.html` の format/version 検出方法
- asset を data URI とするか外部参照を許すか
- AI が編集する単位を Bento JSON 全体にするか patch operation にするか
- slide/page 単位の差分・undo を Artifact Studio 側で持つか

## Acceptance criteria

- [ ] `.bento.html` を import して preview できる
- [ ] Bento JSON を抽出して validation できる
- [ ] prompt から Bento document を生成できる
- [ ] source をブラウザに保存・復元できる
- [ ] `.bento.html` として export できる
- [ ] preview が sandbox されている
- [ ] BPMN / Mermaid と同じ header selector から切替できる
