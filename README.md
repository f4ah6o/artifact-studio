# As-Code Studio

[日本語](README.ja.md)

[![CI](https://github.com/f4ah6o/as-code-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/f4ah6o/as-code-studio/actions/workflows/ci.yml)

As-Code Studio is a local-first workbench for working with structured, text-based artifacts such as business processes, diagrams, policies, workflows, and data models.

You can open an existing artifact or create one locally, edit it in the browser, validate it, inspect a visual representation, and export the result without sending the artifact to a hosted service.

## What you can work with

| Format | What you can do |
|---|---|
| **BPMN** | Generate and import BPMN, edit the process model, validate it, apply deterministic layout, and export BPMN or SVG |
| **Mermaid** | Edit Mermaid source, validate and normalize it, preview the diagram, and export the source |
| **OPA / Rego** | Work with multi-file policy workspaces, format and check Rego, evaluate policies, run tests, inspect coverage, and view dependencies |
| **Dagu** | Edit workflow YAML, edit steps and dependencies visually, inspect the dependency graph, validate, and export YAML |
| **Bonita BDM** | Edit `bdm/bom.xml`, validate its structure, inspect Business Objects and relations, and export the XML |

BPMN currently has the broadest editing workflow, while the same Studio shell is also used for the other artifact types.

## Run As-Code Studio

This repository currently runs from source using Vite+ (`vp`).

```bash
git clone https://github.com/f4ah6o/as-code-studio.git
cd as-code-studio
vp install
vp run dev
```

Then open the Vite development URL shown in the terminal (normally `http://127.0.0.1:5173`).

The local API runs on `http://127.0.0.1:3000` by default.

To use different ports:

```bash
API_PORT=3200 \
VITE_PORT=5273 \
VITE_HOST=127.0.0.1 \
vp run dev
```

## Basic workflow

1. Choose the artifact type you want to work with.
2. Create an artifact or open an existing file.
3. Edit the source or visual model in the Studio.
4. Run the validation and artifact-specific actions you need.
5. Preview or inspect the resulting model, graph, decision, or test view.
6. Export the artifact when you are done.

Supported file types include `.bpmn`, `.xml`, `.mmd`, `.mermaid`, `.rego`, `.yaml`, `.yml`, and OPA workspace JSON files. The Studio also recognizes Bonita `bom.xml` files.

## Optional external tools

Most BPMN and Mermaid work is self-contained.

OPA / Rego actions use the official `opa` executable. Install OPA on your `PATH`, or set `OPA_BINARY` to its absolute path, to enable policy evaluation, tests, coverage, and related actions.

Dagu validation uses the Dagu CLI when that runtime is available.

## BPMN from the command line

The BPMN pipeline can also be used without the browser.

```bash
# Logic-Core JSON -> BPMN + SVG
node src/bpmn/pipeline.js tests/fixtures/simple-approval.json /tmp/simple-approval

# BPMN -> Logic-Core JSON
node src/bpmn/import.js process.bpmn process.json
```

For programmatic use:

```js
import { runPipeline } from './src/bpmn/pipeline.js';

const result = await runPipeline(logicCore);
```

BPMN layout and validation are deterministic; an LLM does not directly generate diagram coordinates.

## MCP and HTTP API

As-Code Studio also exposes local HTTP APIs for its artifact workflows.

The included BPMN MCP server provides these tools:

- `generate_bpmn`
- `validate_bpmn`
- `import_bpmn`
- `orchestrate_bpmn`

See [`references/api-reference.md`](references/api-reference.md) for the HTTP API and [`SKILL.md`](SKILL.md) for the BPMN skill.

## More documentation

Implementation details, adapter design, and ongoing work are kept outside the README so this page can stay focused on using the Studio.

- [Artifact adapter documentation](docs/ARTIFACT-ADAPTERS.md) / [日本語](docs/ARTIFACT-ADAPTERS.ja.md)
- [OPA adapter documentation](docs/OPA-ADAPTER.md) / [日本語](docs/OPA-ADAPTER.ja.md)
- [`docs/`](docs/) — technical documentation
- [`issues/`](issues/) — active and completed implementation work

## License

As-Code Studio is distributed under the [MIT License](LICENSE).

Third-party licenses and attribution are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
