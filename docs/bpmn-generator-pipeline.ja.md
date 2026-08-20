# BPMN Generator Pipeline

[English / original generated documentation](bpmn-generator-pipeline.md)

この文書はpipeline self-diagramの日本語説明である。

## Collaboration

2 Pools / 7 Message Flows。

## User

| Element | Type | 説明 |
|---|---|---|
| プロセス作成が必要 | startEvent | 開始点 |
| プロセスを記述 | userTask | natural languageまたはstructured Logic-Core JSONをCLI / MCP / orchestratorから入力する |
| BPMN diagramを確認 | userTask | BPMN 2.0 XML、SVG preview、compliance report、validation warnings、agent historyを確認する |
| 結果は妥当か | exclusiveGateway | human review |
| 記述を修正 | userTask | missing step、role、gateway等を修正して再実行する |
| diagram完成 | endEvent | 終了点 |

## BPMN Generator System

| Element | Type | 説明 |
|---|---|---|
| Input受信 | startEvent | natural languageまたはLogic-Core JSONを受け取る |
| Input type判定 | exclusiveGateway | text / structured inputを分岐する |
| TextからLogic-Core抽出 | serviceTask | Modelerがschema/rulesを含むpromptを使いstructured JSONへ変換する |
| Structural validation | serviceTask | schemaとrule engineでsoundness/style/pragmatics/WF-Netを検証する |
| Validation pass? | exclusiveGateway | errorがあればrefinement loopへ戻す |
| Logic-Core refinement | serviceTask | review issuesを入力にsemantic modelを修正する |
| Topology inference | serviceTask | gateway direction、topological order、lane order、happy pathをdeterministicに求める |
| ELK layout | serviceTask | Logic-CoreをELK graphへ変換し、layered/Sugiyama系layoutとorthogonal routingを実行する |
| Coordinate transforms | serviceTask | lane/pool調整、alignment、route compaction、deconfliction、endpoint clipping等を適用する |
| BPMN 2.0 XML generation | serviceTask | `bpmn-moddle`でsemantic modelとBPMNDIを生成する |
| Round-trip validation | serviceTask | generated XMLを再parseし、invalid referenceやunknown element等を検出する |
| SVG preview | serviceTask | standalone SVGとしてpool/lane/task/event/gateway/edgeを描画する |
| Compliance check | serviceTask | namespace、required attributes、DI completeness、element mappingを確認する |
| Result assembly | serviceTask | BPMN XML、SVG、validation/compliance結果、historyをまとめる |
| Pipeline complete | endEvent | 完了 |

実際の現在実装については `scripts/pipeline.js` とtest suiteをauthorityとし、このgenerated documentationと差異がある場合はコードを優先する。
