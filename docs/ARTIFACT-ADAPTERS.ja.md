# Artifact Studio — Adapter Architecture

[English](ARTIFACT-ADAPTERS.md)

Artifact Studio は BPMN 固有アプリではなく、artifact typeごとに adapter を差し替えられる workbench として構成する。

```text
prompt / source
  -> generate or import
  -> canonical model
  -> validate / lint
  -> format
  -> render / edit
  -> persist locally
  -> export
```

shell側は Codex integration、status UI、local persistence、generation controls、validation findings、export、review を担当し、artifact固有の意味論を持たない。意味論は各adapterが所有する。

## Adapter contract

適用可能なadapterは概ね次のcapabilityを公開する。

```ts
interface ArtifactAdapter<Model = unknown> {
  id: string;
  label: string;
  extensions: string[];

  generate?(input: string, options?: object): Promise<Model>;
  import?(source: string): Promise<Model>;
  validate?(model: Model): Promise<ValidationResult>;
  format?(model: Model): Promise<Model>;
  render(model: Model, host: HTMLElement): Promise<void>;
  serialize(model: Model): Promise<string>;
  exportFileName(model: Model): string;
}
```

canonical modelはadapter-ownedとする。Artifact Studio coreが保存するのはadapter id、serialized artifact、shell metadataであり、artifact固有modelをcore schemaへ統合しない。

## 現在のadapter

### BPMN

Status: implemented.

- Canonical model: Logic-Core JSON
- Renderer/editor: `bpmn-js`
- Layout/format: ELK + Visual Refinement
- Import/export: BPMN 2.0 XML
- Validation: JSON Schema + project rules + BPMN XML round-trip validation

### Mermaid

Status: implemented.

- Canonical model: Mermaid source text
- Renderer: Mermaid
- Format: deterministic source normalization
- Validation: Mermaid parser/render diagnostics
- Export: `.mmd` / Markdown fenced block / SVG

### OPA / Rego

Status: implemented.

- Canonical model: generic multi-file workspace (`.rego`, JSON, YAML)
- Editor: workspace file list + source editor
- Validation / format / evaluation / test authority: official OPA CLI
- Derived views: dependency graph、decision/evaluation result、test/coverage result
- Persistence/export: generic workspace envelope / `.opa-workspace.json`

## 次のadapter候補

### Dagu

Target: next.

- Canonical model: Dagu workflow YAML
- Renderer/editor: YAML source + generic DAG `GraphProjection` preview
- Validation: official `dagu validate`
- Runtime authority: Dagu CLI / built-in MCP。Artifact Studioはscheduler/runtimeを再実装しない
- Export: `.yaml` / `.yml`

### Bento

Target: after the generic core/Dagu work.

- Canonical artifact: Bento native single-file `.bento.html`
- Canonical document data: file内の `application/bento+json` block (`#bento-doc`)
- Renderer/editor: artifact自身が持つBento runtime
- AI editing: Bento document JSONを編集し、surrounding runtimeを保持する
- Export: `.bento.html`

Bento用に競合する独自page schemaをArtifact Studio側で作らない。

### n8n

Status: deferred.

- Canonical model: n8n workflow JSON
- instance metadataやcredentials bindingなど、Daguよりinstance-orientedなworkflow adapterになる
- Dagu + Bentoでgeneric contractの実需要が見えた後に再評価する

## Persistence

browser persistenceはadapterごとに最新artifactを保持できるworkspace envelopeを利用する。

```text
artifact-studio:workspace:v1
```

現在はsingle-source artifactに加え、OPA導入時にgeneric `workspace` content contractも追加されている。

概念的には次のようにadapterごとのartifactを独立して保持する。

```json
{
  "version": 1,
  "activeAdapter": "mermaid",
  "artifacts": {
    "bpmn": { "source": "...BPMN XML...", "updatedAt": "..." },
    "mermaid": { "source": "...Mermaid...", "updatedAt": "..." }
  }
}
```

旧BPMN-only / single-artifact keyは読み込み時にmigrationする。historyや大きなartifactが必要になれば、同じadapter/content semanticsを維持したままIndexedDB等へ移せるようにする。

## Migration path

1. BPMN applicationを壊さずshell behaviorを抽出する。**Done.**
2. adapter registryとheader selectorを導入する。**BPMN + Mermaid + OPAでDone.**
3. persistenceをmulti-adapter workspace envelopeへ移す。**Done.**
4. Mermaid generation/source editing/parser validation/preview/format/restore/export。**Done.**
5. generic workspace contentと、公式CLIをauthorityとするOPA adapterを追加。**Done.**
6. 残るBPMN固有frontend logicをformal adapter contractの内側へ寄せる。
7. OPAを第1consumerとしてminimal generic capability + `GraphProjection` coreを固定する。
8. Dagu workflow YAMLを第2 `GraphProjection` consumer / next adapterとして追加する。
9. Bentoをnative `.bento.html` boundaryのまま追加する。
10. Dagu/Bentoでinstance-oriented workflow adapterの具体的需要が出た場合にn8nを再評価する。
