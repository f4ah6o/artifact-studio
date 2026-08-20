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

Target:

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

Browser persistence should be namespaced by artifact type:

```text
artifact-studio:last-artifact:v1
```

Stored envelope:

```json
{
  "adapter": "bpmn",
  "version": 1,
  "updatedAt": "...",
  "source": "...serialized artifact..."
}
```

For a recent-artifacts list, move the same envelope to IndexedDB without changing adapter semantics.

## Migration path

1. Keep the current BPMN application working.
2. Extract current BPMN-specific frontend logic into a `bpmn` adapter.
3. Introduce an adapter registry and artifact selector.
4. Move local persistence from a BPMN-only key to the generic envelope.
5. Add Mermaid as the second adapter; it is small enough to validate the abstraction.
6. Add n8n workflow JSON as the first non-text/non-BPMN structured artifact.
7. Add Bento using its native `.bento.html` + embedded `bento/slides` JSON format.
