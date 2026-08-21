# Contributing to As-Code Studio

[日本語](CONTRIBUTING.ja.md)

## Development setup

Run the JavaScript toolchain from the repository root:

```bash
vp install
vp check
vp test --run
vp build
```

Local development app:

```bash
vp run dev
```

## Repository structure

```text
index.html       Vite application entry
vite.config.ts   Vite+ dev/build/test/check configuration
src/client/      browser shell and browser adapter integrations
src/core/        adapter-independent shared contracts
src/adapters/    server-side adapter semantics
src/bpmn/        deterministic BPMN pipeline
src/ai/          AI orchestration, providers, and work sessions
src/server/      HTTP/MCP runtime entry points
tools/           development, benchmark, robustness, and build tooling
tests/           executable tests, fixtures, benchmarks, robustness data
references/      schemas, API/reference material, BPMN rules and prompts
rules/           BPMN rule profiles
docs/            maintained architecture and implementation documentation
issues/open/     active proposals and scoped work
issues/closed/   completed work with evidence
```

## Making changes

1. Read the current implementation before editing it.
2. Read relevant `docs/` and open/closed issue evidence.
3. Keep adapter-specific behavior behind the adapter boundary.
4. Add or update tests with the implementation.
5. Run `vp check`, `vp test --run`, and `vp build` from the repository root before submitting.
6. If a maintained document changes, update its `*.ja.md` companion in the same change.
7. Keep future design out of README; put it in `docs/` or `issues/open/`.

## Adding or changing an adapter

Start from `src/client/artifact-adapters.js` and the generic content contract in `src/client/artifact-content.js`. Adapter-independent contracts live in `src/core/`, while server-side adapter semantics live in `src/adapters/`.

Do not broaden core abstractions for a single adapter unless the abstraction is deliberately being proven by more than one consumer. For shared graph views, follow the `GraphProjection` direction documented in the open architecture issues rather than importing Mermaid or another adapter directly.

Adapter runtime semantics should be validated by the authoritative implementation where possible. The OPA adapter, for example, delegates Rego semantics to the official OPA executable.

## BPMN changes

BPMN remains the most mature adapter. Changes to BPMN semantics/layout should normally consider:

- `src/bpmn/types.js`
- `src/bpmn/rules.js` / `src/bpmn/validate.js`
- `src/bpmn/layout.js`
- `src/bpmn/coordinates.js`
- `src/bpmn/bpmn-xml.js`
- `src/bpmn/svg.js`
- `src/bpmn/import.js`
- `references/input-schema.json`
- relevant BPMN fixtures/tests

If layout or serialization changes, verify round-trip behavior and representative fixtures rather than relying only on a unit test for the modified helper.

## Testing

Tests run with Vite+ / Vitest from the repository root:

```bash
vp test --run
```

`vp check` runs the configured formatting/lint/type-aware checks. `vp build` verifies the browser build.

The repository also contains dynamic robustness fixtures. Do not weaken robustness acceptance or delete a regression fixture merely to make the suite green; fix the generic bug or document why the fixture is invalid.

## Documentation

See [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) / [日本語](docs/DOCUMENTATION.ja.md).

README is a current-state entry point, not a roadmap. Design proposals and future implementation notes belong in `docs/` or `issues/open/`; completed work belongs in `issues/closed/` with evidence.

## License

Contributions to this repository are distributed under the repository's [MIT License](LICENSE). Upstream and third-party notices are maintained in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
