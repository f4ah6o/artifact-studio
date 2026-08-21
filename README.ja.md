# As-Code Studio

[English](README.md)

[![CI](https://github.com/f4ah6o/as-code-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/f4ah6o/as-code-studio/actions/workflows/ci.yml)

As-Code Studio は、Process / Policy / Workflow / Data Model / Diagram などの structured as-code artifact を生成・編集・検証・可視化・変換・保存・書き出しする local-first Workbench です。

現在のコードベースでは5つの adapter を実装しています。

| Adapter | Canonical content | 現在の機能 |
|---|---|---|
| BPMN | Logic-Core JSON / BPMN 2.0 XML | 生成、import、検証、deterministic layout、編集、BPMN + SVG export |
| Mermaid | Mermaid source | 編集、検証、正規化、preview、export |
| OPA / Rego | multi-file workspace | 編集、保存、format、check、eval、test、coverage、dependency graph |
| Dagu | Dagu workflow YAML | 編集、step/dependencyのvisual編集、Dagu CLI検証、dependency graph、export |
| Bonita BDM | Bonita `bdm/bom.xml` | canonical XML編集、構造検証、Business Object確認、relation graph、export |

BPMN が最も成熟した adapter ですが、browser shell と persistence はすでに BPMN 専用ではありません。

## Quick start

このリポジトリの JavaScript toolchain と package manager は Vite+ で管理します。

```bash
vp install
vp run dev
```

開発アプリでは次の2プロセスを起動します。

- As-Code Studio API: 既定 `http://127.0.0.1:3000`
- Vite+ development server: 通常 port `5173`

OPA / Dagu actions は As-Code Studio API の `/api/v1/artifacts/*` 配下で処理し、adapterごとのHTTP portは使用しません。

OPA は optional です。`opa` executable がなくても BPMN / Mermaid は利用できます。OPA actions を使う場合は OPA を `PATH` に置くか、`OPA_BINARY` に absolute executable path を設定してください。

port 等は上書きできます。

```bash
API_PORT=3200 \
VITE_PORT=5273 \
VITE_HOST=127.0.0.1 \
vp run dev
```

## Development gates

リポジトリルートで次を実行します。

```bash
vp check
vp test --run
vp build
```

CI でも supported Node.js LTS 上で同じ gate を実行し、最後に BPMN generation smoke test を行います。

## バージョニング

As-Code Studio は CalVer `YYYY.M.PATCH`（例: `2026.8.0`）を使用します。リリース番号は `f4ah6o/calver-action` で採番し、Action の指定は `YYYY.MM.PATCH`（同Actionの `MM` はゼロ埋めなし月）、タイムゾーンは `Asia/Tokyo` とします。リリースタグに `v` プレフィックスは付けず、immutable tag として扱います。

GitHub Actions の **Release** workflow を手動実行すると、次のバージョンを採番し、検証後、必要なら `package.json` を release-only commit で更新して CalVer tag をpushします。HTTP/MCPが返すアプリバージョンも `package.json` を参照します。

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

As-Code Studio HTTP server を単一のAPI boundaryとし、BPMN / Mermaid / OPA / Dagu / config / chat / telemetry を同じportで提供します。adapter固有actionは `/api/v1/artifacts/<adapter>/...` にnamespaceし、OPA / Dagu CLI等の外部runtimeはadapter内部実装として扱います。

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

As-Code Studio は [MIT License](LICENSE) で配布します。upstream attribution、依存ライブラリのlicense、その他third-party noticeは [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) に集約します。
