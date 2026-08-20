# Artifact Studio

[日本語](README.ja.md)

[![CI](https://github.com/f4ah6o/artifact-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/f4ah6o/artifact-studio/actions/workflows/ci.yml)

Artifact Studio is a local-first workbench for generating, editing, validating, rendering, persisting, and exporting structured artifacts.

The current codebase ships three adapters:

| Adapter | Canonical content | Current capabilities |
|---|---|---|
| BPMN | Logic-Core JSON / BPMN 2.0 XML | generate, import, validate, deterministic layout, edit, export BPMN + SVG |
| Mermaid | Mermaid source | edit, validate, normalize, preview, export |
| OPA / Rego | multi-file workspace | edit, persist, format, check, eval, test, coverage, dependency graph |

BPMN remains the most mature adapter, but the browser shell and persistence layer are no longer BPMN-only.

## Quick start

Vite+ manages the JavaScript toolchain and package manager for this repository.

```bash
vp install
vp run demo
```

The demo starts:

- the Artifact Studio API on `http://127.0.0.1:3000` by default;
- the OPA adapter sidecar on `http://127.0.0.1:3001` by default;
- the Vite+ development server, normally on port `5173`.

OPA is optional. BPMN and Mermaid remain usable without an `opa` executable. To enable OPA actions, install OPA on `PATH` or set `OPA_BINARY` to an absolute executable path.

Useful overrides:

```bash
API_PORT=3200 \
OPA_API_PORT=3201 \
VITE_PORT=5273 \
VITE_HOST=127.0.0.1 \
vp run demo
```

## Development gates

Run these from the repository root:

```bash
vp check
vp test --run
vp build
```

The CI workflow runs the same gates on supported Node.js LTS releases and finishes with a BPMN generation smoke test.

## BPMN pipeline

The original BPMN pipeline remains available as a direct CLI and programmatic API.

```bash
# Logic-Core JSON -> BPMN + SVG
node src/bpmn/pipeline.js tests/fixtures/simple-approval.json /tmp/simple-approval

# Existing BPMN -> Logic-Core JSON
node src/bpmn/import.js process.bpmn process.json
```

Programmatic entry point:

```js
import { runPipeline } from './src/bpmn/pipeline.js';

const result = await runPipeline(logicCore);
```

The BPMN path uses deterministic validation and layout. LLM output is not used to generate coordinates directly.

## Browser architecture

The current browser application is organized around adapter-owned semantics and generic shell state:

```text
index.html               Vite application entry
vite.config.ts           Vite+ dev/build/test/check configuration

src/
  client/                browser shell and browser adapter integrations
  core/                  adapter-independent shared contracts
  adapters/              server-side adapter semantics
  bpmn/                  deterministic BPMN pipeline
  ai/                    AI orchestration and providers
  server/                HTTP/MCP runtime entry points

tools/                   development, benchmark, and robustness tooling
tests/                   executable tests, fixtures, and benchmark evidence
```

Generic artifact content currently supports:

- `text` — single-source artifacts such as Mermaid;
- `workspace` — multi-file artifacts such as OPA.

Adapter-specific runtime semantics stay behind their adapter boundary. For example, Rego evaluation is delegated to the official OPA executable rather than reimplemented in JavaScript.

## HTTP and MCP

The main HTTP server provides BPMN generation/import/validation/orchestration, Mermaid generation, configuration, chat, and telemetry endpoints. The OPA sidecar provides OPA-specific check/format/eval/test/dependency endpoints.

The repository also includes a BPMN MCP server with these tools:

- `generate_bpmn`
- `validate_bpmn`
- `import_bpmn`
- `orchestrate_bpmn`

See [`references/api-reference.md`](references/api-reference.md) for the HTTP API and [`SKILL.md`](SKILL.md) for the agent-facing BPMN skill.

## Documentation

README files describe the **current working codebase** only. Design proposals, migration plans, and future adapter work belong in `docs/` and `issues/`.

Maintained documentation is written in English and Japanese using paired files such as:

```text
docs/ARTIFACT-ADAPTERS.md
docs/ARTIFACT-ADAPTERS.ja.md
```

Start here:

- [Adapter architecture](docs/ARTIFACT-ADAPTERS.md) / [日本語](docs/ARTIFACT-ADAPTERS.ja.md)
- [OPA adapter](docs/OPA-ADAPTER.md) / [日本語](docs/OPA-ADAPTER.ja.md)
- [Documentation policy](docs/DOCUMENTATION.md) / [日本語](docs/DOCUMENTATION.ja.md)
- [`issues/open/`](issues/open/) — active design and implementation work
- [`issues/closed/`](issues/closed/) — completed work with evidence

## License and third-party notices

Artifact Studio is distributed under the [MIT License](LICENSE). Upstream attribution, dependency licenses, and other third-party notices are kept in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
