# Artifact Studio — Adapter Architecture

Artifact Studio treats BPMN as the first implementation of a generic artifact workflow:

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

The canonical model is adapter-owned. Artifact Studio only persists an adapter id plus the serialized current artifact and shell metadata.

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

### n8n

Target:

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

Bento is unusually well suited to the adapter model because the artifact is already local-first, self-contained and AI-editable. Artifact Studio should not invent a competing page schema for Bento; it should use Bento's documented format as the adapter boundary.

## Persistence

Browser persistence uses a workspace envelope so each enabled adapter can retain its latest source independently:

```text
artifact-studio:workspace:v1
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
2. Introduce an adapter registry and header selector. **Done for BPMN + Mermaid.**
3. Move persistence to a multi-adapter workspace envelope. **Done.**
4. Add Mermaid generation, source editing, parser validation, preview, format, restore and export. **Done.**
5. Move more BPMN-specific frontend logic behind a formal adapter contract.
6. Add n8n workflow JSON as the first non-text/non-BPMN structured artifact.
7. Add Bento using its native `.bento.html` format.
