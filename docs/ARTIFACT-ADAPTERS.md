# As-Code Studio — Adapter Architecture

[日本語](ARTIFACT-ADAPTERS.ja.md)


The shared contracts used by adapters are documented in [`ADAPTER-CORE.md`](ADAPTER-CORE.md).

As-Code Studio treats BPMN as the first implementation of a generic artifact workflow:

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

The shell (Codex integration, status UI, local persistence, generation controls, validation findings, export and review) should not know BPMN-specific details. Each artifact type is provided by an adapter.

## Adapter contract

An adapter should expose these capabilities where applicable:

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

The canonical model is adapter-owned. As-Code Studio only persists an adapter id plus the serialized current artifact and shell metadata.

## Initial adapters

### BPMN

Status: implemented today.

- Canonical model: Logic-Core JSON
- Renderer/editor: `bpmn-js`
- Layout/format: ELK + Visual Refinement
- Import/export: BPMN 2.0 XML
- Validation: JSON Schema + project rules + BPMN XML round-trip validation

### Mermaid

Status: implemented.


- Canonical model: Mermaid source text plus optional structured generation metadata
- Renderer: Mermaid
- Format: deterministic source normalization where available
- Validation: Mermaid parser/render diagnostics
- Export: `.mmd` / Markdown fenced block / SVG

### OPA / Rego

Status: implemented.

- Canonical model: generic multi-file workspace (`.rego`, JSON, YAML)
- Editor: workspace file list + source editor
- Validation/format/evaluation/test authority: official OPA CLI
- Derived views: dependency graph, decision/evaluation results, test/coverage results
- Persistence/export: generic workspace envelope / `.opa-workspace.json`

### Dagu

Status: implemented.

- Canonical model: Dagu workflow YAML
- Renderer/editor: YAML source + generic DAG GraphProjection preview
- Validation: official `dagu validate`
- Runtime authority: Dagu CLI / built-in MCP, not As-Code Studio
- Export: `.yaml` / `.yml`

### Bonita BDM

Status: implemented.

- Canonical model: Bonita `bdm/bom.xml`; As-Code Studio does not introduce a competing BDM schema
- Editor/viewer: raw XML + Business Object list/details + relation graph
- Validation: XML and safe structural checks; full runtime compatibility remains Bonita's authority
- Derived view: aggregation/composition `GraphProjection`
- Export: canonical `bom.xml` source without lossy regeneration

### n8n

Target (deferred):

- Canonical model: n8n workflow JSON
- Renderer/editor: initially JSON + generated preview; a richer workflow canvas can be added later
- Validation: workflow schema plus node/credential/reference checks
- Format: stable JSON normalization and deterministic node positioning
- Export: n8n workflow JSON

### Bento

Target:

- Canonical artifact: Bento's own single-file `.bento.html` format
- Canonical document data: the readable `application/bento+json` block (`#bento-doc`) embedded in that file
- Renderer/editor: the Bento runtime already embedded in the artifact
- AI editing: operate on the Bento document JSON and preserve the surrounding runtime
- Export: `.bento.html`

Bento is unusually well suited to the adapter model because the artifact is already local-first, self-contained and AI-editable. As-Code Studio should not invent a competing page schema for Bento; it should use Bento's documented format as the adapter boundary.

## Persistence

Browser persistence uses a workspace envelope so each enabled adapter can retain its latest source independently:

```text
as-code-studio:workspace:v2
```

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

The previous BPMN-only and single-artifact keys are migrated on first load. For history or larger artifacts, move the same adapter/source semantics to IndexedDB.

## Migration path

1. Keep the BPMN application working while extracting shell behavior. **Done.**
2. Introduce an adapter registry and header selector. **Done for BPMN + Mermaid + OPA.**
3. Move persistence to a multi-adapter workspace envelope. **Done.**
4. Add Mermaid generation, source editing, parser validation, preview, format, restore and export. **Done.**
5. Add generic workspace content and the OPA adapter with official-CLI-backed actions. **Done.**
6. Move more BPMN-specific frontend logic behind a formal adapter contract.
7. Formalize the minimal generic capability + GraphProjection core using OPA as the first consumer.
8. Add Dagu workflow YAML as the second GraphProjection consumer and next adapter.
9. Add Bento using its native `.bento.html` format.
10. Revisit n8n only after the Dagu/Bento contracts show a concrete need for an instance-oriented workflow adapter.
