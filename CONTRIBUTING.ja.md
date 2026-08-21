# Artifact Studio への contribution

[English](CONTRIBUTING.md)

## Development setup

JavaScript toolchain はリポジトリルートから実行します。

```bash
vp install
vp check
vp test --run
vp build
```

ローカル開発アプリ:

```bash
vp run dev
```

## Repository structure

```text
index.html       Vite application entry
vite.config.ts   Vite+ dev/build/test/check configuration
src/client/      browser shell / browser adapter integrations
src/core/        adapter-independent shared contracts
src/adapters/    server-side adapter semantics
src/bpmn/        deterministic BPMN pipeline
src/ai/          AI orchestration / providers / work sessions
src/server/      HTTP/MCP runtime entry points
tools/           development / benchmark / robustness / build tooling
tests/           executable tests / fixtures / benchmarks / robustness data
references/      schemas、API/reference material、BPMN rules / prompts
rules/           BPMN rule profiles
docs/            maintained architecture / implementation documentation
issues/open/     active proposals / scoped work
issues/closed/   completion evidence 付きの完了済み作業
```

## Making changes

1. 編集前に現在の実装を読む。
2. 関連する `docs/` と open/closed issue evidence を読む。
3. adapter 固有 behavior は adapter boundary の内側に保つ。
4. 実装と同時に test を追加・更新する。
5. 提出前にリポジトリルートで `vp check`、`vp test --run`、`vp build` を実行する。
6. maintained document を変更した場合は同じ変更で `*.ja.md` companion も更新する。
7. 将来設計は README に置かず、`docs/` または `issues/open/` に置く。

## Adapter の追加・変更

`src/client/artifact-adapters.js` と `src/client/artifact-content.js` の generic content contract から確認します。adapter-independent contract は `src/core/`、server-side adapter semantics は `src/adapters/` に置きます。

単一 adapter の都合だけで core abstraction を広げないでください。shared graph view は Mermaid や別 adapter を直接 import せず、open architecture issue に記載された `GraphProjection` の方向に従います。

adapter runtime semantics は可能な限り authoritative implementation で検証します。たとえば OPA adapter は Rego semantics を JavaScript で再実装せず、公式 OPA executable に委譲します。

## BPMN changes

BPMN は現在もっとも成熟した adapter です。BPMN semantics / layout の変更では通常、次を確認します。

- `src/bpmn/types.js`
- `src/bpmn/rules.js` / `src/bpmn/validate.js`
- `src/bpmn/layout.js`
- `src/bpmn/coordinates.js`
- `src/bpmn/bpmn-xml.js`
- `src/bpmn/svg.js`
- `src/bpmn/import.js`
- `references/input-schema.json`
- 関連する BPMN fixtures / tests

layout や serialization を変更した場合は、変更 helper の unit test だけでなく round-trip behavior と代表 fixture も検証します。

## Testing

Test はリポジトリルートから Vite+ / Vitest で実行します。

```bash
vp test --run
```

`vp check` は設定済みの formatting / lint / type-aware checks を実行し、`vp build` は browser build を検証します。

repository には dynamic robustness fixtures もあります。suite を green にするだけのために robustness acceptance を弱めたり regression fixture を削除したりせず、generic bug を修正するか fixture が無効な理由を文書化します。

## Documentation

[`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) / [日本語](docs/DOCUMENTATION.ja.md) を参照してください。

README は現在状態の入口であり roadmap ではありません。設計案や将来の実装 note は `docs/` または `issues/open/`、完了した作業は evidence 付きで `issues/closed/` に置きます。

## License

この repository への contribution は repository の [MIT License](LICENSE) で配布されます。upstream / third-party notice は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) で管理します。
