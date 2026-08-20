# Artifact Studio

[English](README.md)

[![CI](https://github.com/f4ah6o/artifact-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/f4ah6o/artifact-studio/actions/workflows/ci.yml)

Artifact Studio は、構造化 Artifact の生成・編集・検証・描画・保存・書き出しを行う local-first の Workbench です。

現在のコードベースでは3つの adapter を実装しています。

| Adapter | Canonical content | 現在の機能 |
|---|---|---|
| BPMN | Logic-Core JSON / BPMN 2.0 XML | 生成、import、検証、deterministic layout、編集、BPMN + SVG export |
| Mermaid | Mermaid source | 編集、検証、正規化、preview、export |
| OPA / Rego | multi-file workspace | 編集、保存、format、check、eval、test、coverage、dependency graph |

BPMN が最も成熟した adapter ですが、browser shell と persistence はすでに BPMN 専用ではありません。

## Quick start

このリポジトリの JavaScript toolchain と package manager は Vite+ で管理します。

```bash
vp install
vp run demo
```

demo では次の3プロセスを起動します。

- Artifact Studio API: 既定 `http://127.0.0.1:3000`
- OPA adapter sidecar: 既定 `http://127.0.0.1:3001`
- Vite+ development server: 通常 port `5173`

OPA は optional です。`opa` executable がなくても BPMN / Mermaid は利用できます。OPA actions を使う場合は OPA を `PATH` に置くか、`OPA_BINARY` に absolute executable path を設定してください。

port 等は上書きできます。

```bash
API_PORT=3200 \
OPA_API_PORT=3201 \
VITE_PORT=5273 \
VITE_HOST=127.0.0.1 \
vp run demo
```

## Development gates

リポジトリルートで次を実行します。

```bash
vp check
vp test --run
vp build
```

CI でも supported Node.js LTS 上で同じ gate を実行し、最後に BPMN generation smoke test を行います。

## BPMN pipeline

元の BPMN pipeline は CLI / programmatic API として引き続き利用できます。

```bash
# Logic-Core JSON -> BPMN + SVG
node src/bpmn/pipeline.js tests/fixtures/simple-approval.json /tmp/simple-approval

# Existing BPMN -> Logic-Core JSON
node src/bpmn/import.js process.bpmn process.json
```

Programmatic entry point:

```js
import { runPipeline } from './src/bpmn/pipeline.js';

const result = await runPipeline(logicCore);
```

BPMN path は deterministic validation / layout を使います。LLM が座標を直接生成する構成ではありません。

## Browser architecture

現在の browser application は、adapter が意味論を所有し、shell が generic state を扱う構成です。

```text
index.html               Vite application entry
vite.config.ts           Vite+ dev/build/test/check configuration

src/
  client/                browser shell / browser adapter integrations
  core/                  adapter-independent shared contracts
  adapters/              server-side adapter semantics
  bpmn/                  deterministic BPMN pipeline
  ai/                    AI orchestration / providers
  server/                HTTP/MCP runtime entry points

tools/                   development / benchmark / robustness tooling
tests/                   executable tests / fixtures / benchmark evidence
```

Generic artifact content は現在次の2種類です。

- `text` — Mermaid のような single-source artifact
- `workspace` — OPA のような multi-file artifact

adapter 固有の runtime semantics は adapter boundary の内側に留めます。たとえば Rego evaluation は JavaScript で再実装せず、公式 OPA executable に委譲します。

## HTTP / MCP

main HTTP server は BPMN generate/import/validate/orchestrate、Mermaid generation、config、chat、telemetry を提供します。OPA sidecar は OPA 固有の check/format/eval/test/dependency endpoints を提供します。

BPMN MCP server には次の tools があります。

- `generate_bpmn`
- `validate_bpmn`
- `import_bpmn`
- `orchestrate_bpmn`

HTTP API は [`references/api-reference.md`](references/api-reference.md)、agent 向け BPMN skill は [`SKILL.md`](SKILL.md) を参照してください。

## Documentation

README は **現在動いているコードベース**だけを説明します。設計案、migration plan、将来の adapter 構想は `docs/` と `issues/` に書きます。

保守対象ドキュメントは英語版と日本語版をペアで管理します。

```text
docs/ARTIFACT-ADAPTERS.md
docs/ARTIFACT-ADAPTERS.ja.md
```

入口:

- [Adapter architecture](docs/ARTIFACT-ADAPTERS.md) / [日本語](docs/ARTIFACT-ADAPTERS.ja.md)
- [OPA adapter](docs/OPA-ADAPTER.md) / [日本語](docs/OPA-ADAPTER.ja.md)
- [Documentation policy](docs/DOCUMENTATION.md) / [日本語](docs/DOCUMENTATION.ja.md)
- [`issues/open/`](issues/open/) — active な設計・実装
- [`issues/closed/`](issues/closed/) — completion evidence 付きの完了済み作業

## License / third-party notices

Artifact Studio は [MIT License](LICENSE) で配布します。upstream attribution、依存ライブラリのlicense、その他third-party noticeは [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) に集約します。
