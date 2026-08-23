# As-Code Studio

[English](README.md)

[![CI](https://github.com/f4ah6o/as-code-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/f4ah6o/as-code-studio/actions/workflows/ci.yml)

As-Code Studio は、業務プロセス、図、ポリシー、ワークフロー、データモデルなどの **構造化された as-code artifact** をローカルで扱うための Workbench です。

既存ファイルを開く、artifact を作る、ブラウザ上で編集する、検証する、可視化する、必要な処理を実行する、書き出す、という一連の作業をひとつの Studio で行えます。

## 対応しているもの

| 形式 | できること |
|---|---|
| **BPMN** | BPMN の生成・import、プロセスモデル編集、検証、deterministic layout、BPMN / SVG export |
| **Mermaid** | Mermaid source の編集、検証、正規化、preview、source export |
| **OPA / Rego** | 複数ファイルの policy workspace、format、check、policy evaluation、test、coverage、dependency 表示 |
| **Dagu** | Workflow YAML 編集、step / dependency の visual 編集、dependency graph、検証、YAML export |
| **Bonita BDM** | `bdm/bom.xml` 編集、構造検証、Business Object / relation の確認、XML export |

現在は BPMN が最も機能の揃った workflow ですが、他の artifact も同じ Studio 上で扱えます。

## As-Code Studio を起動する

現在は Vite+ (`vp`) を使ってソースから起動します。

```bash
git clone https://github.com/f4ah6o/as-code-studio.git
cd as-code-studio
vp install
vp run dev
```

起動後、ターミナルに表示される Vite の URL をブラウザで開きます。通常は `http://127.0.0.1:5173` です。

ローカル API は既定で `http://127.0.0.1:3000` を使用します。

ポートを変更する場合:

```bash
API_PORT=3200 \
VITE_PORT=5273 \
VITE_HOST=127.0.0.1 \
vp run dev
```

## 基本的な使い方

1. 扱いたい artifact の種類を選びます。
2. 新しく作るか、既存ファイルを開きます。
3. Studio 上で source または visual model を編集します。
4. validation や artifact 固有の action を実行します。
5. model、graph、decision、test などの view で結果を確認します。
6. 完成した artifact を export します。

`.bpmn`、`.xml`、`.mmd`、`.mermaid`、`.rego`、`.yaml`、`.yml`、OPA workspace JSON などを扱えます。Bonita の `bom.xml` も認識します。

## Architecture Graph

**Architecture** workspace view では、各形式の native source を置き換えずに、artifact やその内部要素を形式横断で関連付けられます。

- Artifact 全体、または BPMN task、Rego rule、Dagu step、Bonita BDM field などの具体的な要素同士に relationship を作成できます。
- Canonical source から検出した dependency も表示します。現在は OPA rule dependency と Dagu の `depends` 宣言に対応しています。
- 手動で作成した relationship はローカル workspace に保存し、検出した relationship は source から都度導出します。
- Graph node をクリックすると元の artifact を開き、対応している形式では該当要素まで focus します。

現在 SemanticEntity を公開しているのは BPMN、OPA / Rego、Dagu、Bonita BDM です。

## 外部ツールが必要な機能

BPMN と Mermaid の主な機能は As-Code Studio 単体で利用できます。

OPA / Rego の action は公式 `opa` executable を使用します。policy evaluation、test、coverage などを使う場合は OPA を `PATH` に置くか、`OPA_BINARY` に executable の絶対パスを設定してください。

Dagu の検証は、Dagu CLI が利用できる環境ではその runtime を使用します。

## BPMN をコマンドラインから使う

BPMN pipeline はブラウザを使わず直接実行することもできます。

```bash
# Logic-Core JSON -> BPMN + SVG
node src/bpmn/pipeline.js tests/fixtures/simple-approval.json /tmp/simple-approval

# BPMN -> Logic-Core JSON
node src/bpmn/import.js process.bpmn process.json
```

JavaScript から利用する場合:

```js
import { runPipeline } from './src/bpmn/pipeline.js';

const result = await runPipeline(logicCore);
```

BPMN の validation と layout は deterministic に処理され、LLM が図の座標を直接生成する構成ではありません。

## MCP / HTTP API

As-Code Studio は artifact workflow を操作するためのローカル HTTP API も提供します。

付属の BPMN MCP server では次の tools を利用できます。

- `generate_bpmn`
- `validate_bpmn`
- `import_bpmn`
- `orchestrate_bpmn`

HTTP API は [`references/api-reference.md`](references/api-reference.md)、BPMN skill は [`SKILL.md`](SKILL.md) を参照してください。

## 詳しいドキュメント

README は Studio を使う人向けの入口に限定し、内部実装、adapter 設計、進行中の開発内容は別のドキュメントに置いています。

- [Artifact adapter documentation](docs/ARTIFACT-ADAPTERS.md) / [日本語](docs/ARTIFACT-ADAPTERS.ja.md)
- [OPA adapter documentation](docs/OPA-ADAPTER.md) / [日本語](docs/OPA-ADAPTER.ja.md)
- [`docs/`](docs/) — 技術ドキュメント
- [`issues/`](issues/) — 進行中・完了済みの実装作業

## License

As-Code Studio は [MIT License](LICENSE) で配布します。

依存ライブラリなどの license / attribution は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) にまとめています。
