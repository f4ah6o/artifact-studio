# Artifact StudioへのContributing

[English](CONTRIBUTING.md)

## Development setup

```bash
cd scripts
vp install
vp check
vp test --run
vp build
```

local demo:

```bash
vp run demo
```

## Repository structure

```text
frontend/        browser shell、adapters、artifact persistence、UI
scripts/         BPMN pipeline、HTTP/MCP servers、adapter-side logic、tests
references/      schemas、API/reference material、BPMN rules/prompts
rules/           BPMN rule profiles
docs/            保守対象のarchitecture / implementation docs
issues/open/     active proposals / scoped work
issues/closed/   completion evidence付きの完了済み作業
tests/           fixtures、benchmarks、robustness data
```

## 変更するとき

1. 変更前に現在の実装を読む。
2. 関連する `docs/`、open/closed issue evidenceを読む。
3. adapter固有behaviorをadapter boundaryの内側に保つ。
4. 実装と同時にtestを追加・更新する。
5. submit前に `vp check`, `vp test --run`, `vp build` を通す。
6. 保守対象documentを変更したら同じ変更で `*.ja.md` counterpartも更新する。
7. 将来設計をREADMEへ書かず、`docs/` または `issues/open/` に置く。

## Adapterを追加・変更する場合

`frontend/artifact-adapters.js` と `frontend/artifact-content.js` のgeneric content contractから確認する。

1 adapterだけの都合でcore abstractionを広げない。複数consumerで再利用が確認できる場合にgeneric coreへ昇格する。shared graph viewはMermaid等を直接importせず、open architecture issueの `GraphProjection` 方針に従う。

runtime semanticsに公式implementationがある場合はそれをauthorityとする。OPA adapterではRego semanticsを公式 OPA executableへ委譲している。

## BPMN変更

BPMNは現在もっとも成熟したadapter。semantic/layout変更では主に次を確認する。

- `scripts/types.js`
- `scripts/rules.js` / `scripts/validate.js`
- `scripts/layout.js`
- `scripts/coordinates.js`
- `scripts/bpmn-xml.js`
- `scripts/svg.js`
- `scripts/import.js`
- `references/input-schema.json`
- relevant BPMN fixtures/tests

layout/serialization変更ではhelper unit testだけでなく、round-tripとrepresentative fixturesも検証する。

## Testing

Vite+ / Vitestを使う。

```bash
cd scripts
vp test --run
```

`vp check` はformat/lint/type-aware checks、`vp build` はbrowser buildを検証する。

robustness fixtureをsuiteをgreenにするためだけに削除したりacceptanceを弱めたりしない。generic bugを直すか、そのfixtureがinvalidである根拠を記録する。

## Documentation

[`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) / [日本語](docs/DOCUMENTATION.ja.md) に従う。

READMEはcurrent-state entry pointでありroadmapではない。design proposal / future implementation noteは `docs/` または `issues/open/`、完了済み作業はevidence付きで `issues/closed/` に置く。

## License

contributionはrepositoryの [MIT License](LICENSE) で配布する。upstream / third-party noticeは [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) に集約する。
