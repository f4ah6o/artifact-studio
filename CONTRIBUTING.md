# Contributing to Artifact Studio

[日本語](CONTRIBUTING.ja.md)

## Development setup

```bash
cd scripts
vp install
vp check
vp test --run
vp build
```

Local demo:

```bash
vp run demo
```

## Repository structure

```text
frontend/        browser shell, adapters, artifact persistence, UI
scripts/         BPMN pipeline, HTTP/MCP servers, adapter-side logic, tests
references/      schemas, API/reference material, BPMN rules and prompts
rules/           BPMN rule profiles
docs/            maintained architecture and implementation documentation
issues/open/     active proposals and scoped work
issues/closed/   completed work with evidence
tests/           fixtures, benchmarks, robustness data
```

## Making changes

1. Read the current implementation before editing it.
2. Read relevant `docs/` and open/closed issue evidence.
3. Keep adapter-specific behavior behind the adapter boundary.
4. Add or update tests with the implementation.
5. Run `vp check`, `vp test --run`, and `vp build` before submitting.
6. If a maintained document changes, update its `*.ja.md` companion in the same change.
7. Keep future design out of README; put it in `docs/` or `issues/open/`.

## Adding or changing an adapter

Start from `frontend/artifact-adapters.js` and the generic content contract in `frontend/artifact-content.js`.

Do not broaden core abstractions for a single adapter unless the abstraction is deliberately being proven by more than one consumer. For shared graph views, follow the `GraphProjection` direction documented in the open architecture issues rather than importing Mermaid or another adapter directly.

Adapter runtime semantics should be validated by the authoritative implementation where possible. The OPA adapter, for example, delegates Rego semantics to the official OPA executable.

## BPMN changes

BPMN remains the most mature adapter. Changes to BPMN semantics/layout should normally consider:

- `scripts/types.js`
- `scripts/rules.js` / `scripts/validate.js`
- `scripts/layout.js`
- `scripts/coordinates.js`
- `scripts/bpmn-xml.js`
- `scripts/svg.js`
- `scripts/import.js`
- `references/input-schema.json`
- relevant BPMN fixtures/tests

If layout or serialization changes, verify round-trip behavior and representative fixtures rather than relying only on a unit test for the modified helper.

## Testing

Tests run with Vite+ / Vitest:

```bash
cd scripts
vp test --run
```

`vp check` runs the configured formatting/lint/type-aware checks. `vp build` verifies the browser build.

The repository also contains dynamic robustness fixtures. Do not weaken robustness acceptance or delete a regression fixture merely to make the suite green; fix the generic bug or document why the fixture is invalid.

## Documentation

See [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) / [日本語](docs/DOCUMENTATION.ja.md).

README is a current-state entry point, not a roadmap. Design proposals and future implementation notes belong in `docs/` or `issues/open/`; completed work belongs in `issues/closed/` with evidence.

## License

Contributions to this repository are distributed under the repository's [MIT License](LICENSE). Upstream and third-party notices are maintained in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
