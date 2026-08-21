# OPA / Rego adapter

[日本語](OPA-ADAPTER.ja.md)

Artifact Studio treats Open Policy Agent policy code as a generic multi-file artifact. The adapter does not contain organization, role, kintone, Kubernetes, Terraform, or other domain-specific policy rules.

## Runtime requirement

The adapter delegates Rego semantics to the official `opa` executable. Install OPA and make `opa` available on `PATH`, or set `OPA_BINARY` on the Artifact Studio server process to an absolute executable path.

The browser never evaluates Rego itself.

## Workspace model

OPA uses the generic workspace content envelope:

```json
{
  "kind": "workspace",
  "files": {
    "policy/authz.rego": "package authz\n...",
    "data.json": "{\"permissions\": {}}",
    "input.json": "{\"user\": \"alice\"}"
  },
  "entrypoints": ["data.authz.allow"],
  "activeFile": "policy/authz.rego",
  "inputFile": "input.json"
}
```

Supported text files are `.rego`, `.json`, `.yaml`, and `.yml`. A single `.rego` file is represented as a one-file workspace. Multiple files can be imported together. Multi-file export uses `policy.opa-workspace.json`; a one-file Rego workspace exports directly as `.rego`.

## Actions

The server-side adapter uses OPA CLI commands as the semantic authority:

- Validate: `opa check --format=json`
- Format: `opa fmt --check-result` for Rego; deterministic formatting for JSON
- Evaluate: `opa eval --format=json --explain=notes`
- Tests: `opa test --format=json`
- Coverage: `opa test --coverage --format=json`
- Dependencies: `opa deps --format=json`

Validation errors are projected into Artifact Studio's common finding shape. Dependency output is projected into a generic graph and rendered through the existing Mermaid renderer; Mermaid is a derived view, not the canonical OPA artifact.

## Security boundary

OPA runs in a fresh temporary directory for every action. Client-supplied file names are never used as host filesystem roots or command names.

The adapter enforces:

- relative forward-slash workspace paths only
- rejection of `..`, absolute paths, Windows drive paths, empty path segments, and unsupported file extensions
- fixed argument arrays with `spawn(..., { shell: false })`
- no client-controlled command/options
- per-file, workspace, request, stdout, and stderr size limits
- command timeouts
- isolated temporary workspaces removed after each action
- child environment allowlisting so `OPA_<COMMAND>_<FLAG>` environment variables cannot silently alter CLI behavior
- an OPA capabilities file derived from the installed OPA version with `allow_net: []`

`allow_net: []` prevents policies from using OPA network-capable built-ins such as `http.send` and `net.lookup_ip_addr` to contact external hosts during validation/evaluation/test.

## Development

`vp run dev` starts the Artifact Studio API and the Vite+ development server. OPA actions are handled directly by the main Artifact Studio HTTP server under `/api/v1/artifacts/opa/*`; there is no OPA sidecar port.

The OPA CLI remains an adapter implementation detail. Its process execution, temporary workspace, request-size limits, timeout handling, and error mapping remain isolated inside the OPA adapter boundary.

If OPA is not installed, the rest of Artifact Studio remains usable and OPA actions return `OPA_UNAVAILABLE` / HTTP 503.

## Non-goals

The adapter intentionally does not provide a business-policy DSL, a role/organization schema, OPA deployment, authorization middleware, or a JavaScript Rego evaluator. Domain-specific sources should be generated or maintained outside Artifact Studio and imported as ordinary OPA workspace files.
