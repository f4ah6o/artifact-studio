# Pipeline Robustness Stack — 日本語ドキュメント

[English](ROBUSTNESS-STACK.md)

## 1. 概要

Pipeline Robustness Stackは、LLMが生成したsynthetic inputを既存BPMN pipelineへ投入し、pipeline failureをregression fixtureへ変換するJS-onlyのsidecar toolである。

目的はpipelineを別実装することではない。既存の `runPipeline()` をそのまま呼び、production input distributionに近いLLM-generated inputで壊れ方を探索する。

```text
synthetic generation
  -> pre-filter
  -> existing pipeline
  -> round-trip checks
  -> failure classification
  -> fingerprint dedup
  -> regression fixtures
  -> Markdown / JSON reports
```

発見された正当なpipeline failureは `tests/fixtures/robustness/auto/` に保存され、`tests/robustness.test.js` がregression testとして自動読込する。

## 2. Architecture

既存pipelineのcore modulesをrobustness stackから変更しないことが重要なboundaryである。

- `pipeline.js`, `rules.js`, `layout.js`, `coordinates.js`, `bpmn-xml.js`, `svg.js` をsidecar都合で変更しない
- existing LLM providerをconsumerとして利用する
- `runPipeline()`, `runRules()`, `validateLogicCore()`, import/DOT conversion等のpublic behaviorだけを利用する
- outputはfixturesとreportsに限定する

主なmodule:

```text
tools/robustness/
  seed-catalog.json
  synthetic-generator.js
  stress-tester.js
  failure-classifier.js
  fixture-persister.js
  report-generator.js
  graph-isomorphism.js
  mad-validator.js
  cli.js
```

## 3. Generation space

seed catalogはdomain、complexity、pattern、stress modeのCartesian productを使う。

- Domains: procurement, hr-onboarding, claims, incident-mgmt, loan-approval, order-fulfillment
- Complexity: simple / medium / complex
- Patterns: four-eyes, escalation, compensation, event-subprocess, pools-collaboration, ad-hoc
- Stress modes: normal, deep-nesting, wide-parallelism, many-lanes, edge-label-density

合計540 cellsからseeded PRNGでsampleする。

## 4. Two-step prompting

synthetic generatorは原則2段階で生成する。

1. process descriptionを生成
2. descriptionからLogic-Core JSONまたはDOTを生成

one-shotよりfailure originを分離しやすく、description qualityとschema mapping qualityを別々に観測できる。

## 5. Stress test

### Pre-filter

最初にschema validationとrule engineを通す。ここで落ちるものは原則LLM quality signalであり、pipeline bugとして扱わない。

### Pipeline checks

pre-filterを通過したinputについて、既存pipelineを1回実行し次を確認する。

- pipeline throw
- validation errors
- BPMN XML生成失敗
- SVG生成失敗
- timeout
- BPMN -> Logic-Core round-trip structural mismatch

## 6. Failure classification

主なcategory:

| Category | Meaning | Bucket |
|---|---|---|
| `schema-violation` | schema pre-filter失敗 | `llm-signal/` |
| `rule-violation` | rule pre-filter失敗 | `llm-signal/` |
| `elk-error` | layout/pipeline failure | `auto/` |
| `xml-malform` | XML欠落またはparse failure | `auto/` |
| `svg-render-issue` | SVG failure | `auto/` |
| `timeout` | pipeline timeout | `auto/` |
| `roundtrip-break` | structural round-trip mismatch | `auto/` |
| `unknown` | 未分類 | `triage/` |

fingerprintはcategory、canonicalized error、structural signatureからSHA-256で生成し、同一bugのfixture重複を避ける。同fingerprint再発時は`seen`を増やす。

## 7. Fixture buckets

```text
tests/fixtures/robustness/
  auto/        confirmed pipeline regression candidates
  triage/      human review queue
  llm-signal/  LLM-quality signal; persistence is gated
```

`llm-signal/` はdefaultではpersistしない。pipelineが受け入れるべき正当inputと、LLMがschema/ruleを破っただけのinputを混同しないためである。

## 8. Reports and drift

run resultはMarkdown + JSON reportへ集約する。

- total/pass/fail
- category別件数
- new fixture count
- fingerprint set
- previous runとの差分

新しいfingerprintはregression候補、消えたfingerprintはfix evidenceとして扱える。

## 9. Graph round-trip

`graph-isomorphism.js` は完全なVF2 implementationではなく、最大50 node程度のLogic-Core向けstructural equality checkerである。

実コードに存在するformat差を吸収するため、modern pooled / project default / legacy flatの複数shapeを読める。sidecar側の都合でimport coreを変更しない。

## 10. Commands

現在の詳細なflagと環境変数は `tools/robustness/cli.js` と英語版documentをauthorityとする。代表例:

```bash
# endpoint connectivity
node tools/robustness/cli.js smoke-test

# Logic-Core target stress run
node tools/robustness/cli.js run --n=100 --target=lc-json

# DOT target
node tools/robustness/cli.js run --n=100 --target=dot

# both targets + MaD sanity check
node tools/robustness/cli.js run --n=200 --target=both --with-mad

# manual triage
node tools/robustness/cli.js triage
```

## 11. Iteration loop

```text
run robustness stack
  -> auto fixture appears
  -> inspect a legitimate pipeline failure
  -> fix generic pipeline bug
  -> regression test turns green
  -> next report shows fingerprint closed
```

このloopによって「LLMが自然に生成するが人手fixtureでは想定しなかったinput」をproduction evidenceへ変換する。

## 12. Limitations

- LLM generation自体はdeterministicではないため、seedはcell samplingを固定してもmodel outputまでは固定しない
- structural equalityはfull graph isomorphismではない
- external dataset sanity checkはdataset availabilityに依存する
- LLM-quality failureとpipeline failureのboundaryはclassifier/triageで継続的に改善する必要がある

## 13. Authority

この文書より、現在の実装・tests・configを優先する。

- `tools/robustness/`
- `tests/robustness-internal.test.js`
- `tests/robustness.test.js`
- `tests/fixtures/robustness/`

historical design/planは `docs/superpowers/` にsnapshotとして残す。
