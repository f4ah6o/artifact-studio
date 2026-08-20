# OPA / Rego adapter

[English](OPA-ADAPTER.md)

Artifact Studioでは Open Policy Agent policy code をgenericなmulti-file artifactとして扱う。adapter本体にorganization、role、kintone、Kubernetes、Terraform等のdomain-specific policy ruleは持たせない。

## Runtime requirement

Rego semanticsは公式 `opa` executableへ委譲する。OPAをinstallして`PATH`から実行可能にするか、Artifact Studio server processの`OPA_BINARY`にabsolute executable pathを指定する。

browser内でRego evaluatorを再実装しない。

## Workspace model

OPAはgeneric workspace content envelopeを利用する。

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

対応text fileは `.rego`, `.json`, `.yaml`, `.yml`。単一 `.rego` も1-file workspaceとして扱い、複数fileをまとめてimportできる。multi-file exportは `policy.opa-workspace.json`、1-file Rego workspaceは `.rego` として直接exportできる。

## Actions

server-side adapterではOPA CLIをsemantic authorityとする。

- Validate: `opa check --format=json`
- Format: Regoは `opa fmt --check-result`、JSONはdeterministic formatting
- Evaluate: `opa eval --format=json --explain=notes`
- Tests: `opa test --format=json`
- Coverage: `opa test --coverage --format=json`
- Dependencies: `opa deps --format=json`

validation errorsはArtifact Studio共通findingへprojectする。dependency outputはgeneric graphへprojectし、既存Mermaid rendererで描画できる。Mermaid sourceはderived viewであり、OPA canonical artifactではない。

## Security boundary

OPA actionごとにfresh temporary directoryを作る。client-supplied filenameをhost filesystem rootやcommand名として使わない。

adapterで次を強制する。

- relative forward-slash workspace pathのみ許可
- `..`、absolute path、Windows drive path、empty segment、unsupported extensionを拒否
- fixed argv + `spawn(..., { shell: false })`
- client-controlled command/optionsを禁止
- per-file / workspace / request / stdout / stderr size limit
- command timeout
- actionごとのisolated temporary workspaceとcleanup
- child environment allowlistにより `OPA_<COMMAND>_<FLAG>` injectionを防止
- installed OPA versionからcapabilities fileを生成し `allow_net: []` を設定

`allow_net: []` によりvalidation/evaluation/test中に `http.send` や `net.lookup_ip_addr` 等のnetwork-capable built-inから外部hostへ接続できないようにする。

## Development

`vp run demo` は次の3processを起動する。

1. Artifact Studio API
2. OPA adapter API（既定 `127.0.0.1:3001`）
3. Vite+ dev server。`/api/v1/artifacts/opa/*` をOPA sidecarへproxyする

sidecar portは `OPA_API_PORT` で変更でき、loopbackのみにbindする。

OPA未installでもArtifact Studioの他機能は利用でき、OPA actionsだけが `OPA_UNAVAILABLE` / HTTP 503を返す。

## Non-goals

このadapterではbusiness-policy DSL、role/organization schema、OPA deployment、authorization middleware、JavaScript Rego evaluatorを提供しない。domain-specific sourceはArtifact Studio外部で生成・管理し、通常のOPA workspaceとしてimportする。
