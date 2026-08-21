# AI-assisted BPMN Modeler

[日本語](ai-assisted-modeler.ja.md)

## Goal

Use BPMN as an interactive business-process model shared by humans, deterministic validation, and Codex-assisted discovery/review.

The browser editor is intentionally not the source of business rules. It edits BPMN; the server imports BPMN back into Logic-Core, validates it deterministically, and exposes the same semantic model to Codex.

## AI runtime: Codex app-server

The web application does **not** call an LLM API directly. Codex app-server is the AI runtime and owns model/auth/session behavior.

```text
Browser / bpmn-js
      |
      | HTTP
      v
As-Code Studio HTTP server
      |
      | stdio JSONL / JSON-RPC
      v
codex app-server
      |
      +-- ChatGPT managed authentication
      +-- threads / turns / streamed items
      +-- model selection / reasoning effort
      +-- outputSchema
```

The implementation uses the default `stdio` transport. WebSocket app-server transport is intentionally not required by this application.

`CodexAppServerClient` performs the required lifecycle:

```text
spawn codex app-server
  -> initialize
  -> initialized
  -> account/read
  -> model/list
  -> thread/start (new Artifact AI work session)
     OR thread/resume (continued work session)
  -> turn/start (current model / reasoning effort)
  -> item/* notifications
  -> turn/completed
```

As-Code Studio keeps Codex runtime metadata separate from canonical artifact content. The browser persists only an opaque `aiSessionId` plus the selected model/effort for each Artifact work session; raw Codex `threadId` values stay server-side. Reloading the page reuses the same work-session identity, while switching to another Artifact resolves a different session. Opening replacement artifact content starts a new work-session identity.

The model selector is populated from app-server `model/list`. The advertised default model and each model's `defaultReasoningEffort` / `supportedReasoningEfforts` are authoritative. `CODEX_MODEL` and `CODEX_EFFORT` remain deployment/bootstrap overrides. Changing the UI selection is applied by `turn/start` on subsequent turns and does not restart app-server.

`thread/resume` is attempted for an existing work session. If Codex reports that the persisted rollout no longer exists, As-Code Studio starts a new thread and exposes the context reset in the safe AI-session status instead of leaking or accepting a browser-supplied thread id.

For the browser UI, ChatGPT login is initiated through `account/login/start` with `type: chatgpt`; the returned authorization URL is opened in the user's browser. There is no OpenAI API-key input in the BPMN UI.

### Deployment scope

The current MVP assumes a **single-user/local app-server process**. This is intentional.

A shared central web deployment must not multiplex unrelated users through one Codex account/session. Before multi-user deployment, isolate Codex app-server state and authentication per user (or adopt a supported remote-host architecture). The current app-server WebSocket transport is not a production dependency for this MVP.

## BPMN architecture

```text
Natural language
      |
      v
/api/v1/orchestrate
      |
      v
 Codex app-server
      |
      v
 Logic-Core --------------------+
      |                         |
      v                         v
 pipeline                 deterministic rules
      |                         |
      v                         v
 BPMN XML                 validation findings
      |                         |
      +----------+--------------+
                 v
             bpmn-js
                 |
          human editing
                 |
                 v
          /api/v1/import
                 |
                 v
             Logic-Core
```

The frontend also calls `/api/v1/chat` with the current Logic-Core as context for the grilling workflow. This is deliberately advisory: the LLM does not mutate BPMN XML directly.

## Design rules

1. **Codex app-server is the AI boundary.** Browser code never holds model-provider credentials.
2. **LLMs do not write coordinates.** Layout remains deterministic in the existing pipeline.
3. **LLMs do not directly patch BPMN XML.** AI edits are represented as semantic operations against Logic-Core.
4. **Deterministic validation runs before AI review.** Structural errors should not consume model reasoning.
5. **Every finding should be element-grounded where possible.** The UI maps element IDs to bpmn-js overlays.
6. **Manual BPMN edits round-trip through Logic-Core.** `bpmn-js -> saveXML -> /import -> /validate` keeps the semantic model synchronized.
7. **Do not depend on experimental dynamic tools for core editing.** Structured findings and edit proposals use `turn/start.outputSchema`; application remains deterministic server-side.
8. **Codex execution is read-only for this workflow.** The adapter starts turns with a read-only sandbox and never auto-approves command or file-write requests.

## Current MVP

- editable bpmn-js modeler
- natural-language generation through `/api/v1/orchestrate`
- Codex app-server adapter over stdio
- Artifact-scoped Codex thread continuation with explicit AI-session reset
- app-server `model/list` driven model/reasoning-effort controls
- ChatGPT managed-login bootstrap through app-server
- `.bpmn` import/export
- BPMN-to-Logic-Core synchronization after edits
- deterministic validation findings in the right panel
- overlays on BPMN elements when a finding contains a matching element ID
- selected-element inspection
- Codex grilling using the current Logic-Core as context

## Next slice: structured grilling findings

Add a dedicated review endpoint returning structured findings instead of plain chat text. The result should be constrained with Codex `turn/start.outputSchema`.

```json
{
  "findings": [
    {
      "id": "GRILL-001",
      "elementIds": ["Gateway_Approval"],
      "kind": "missing_exception",
      "severity": "question",
      "question": "否認された場合、どこへ戻しますか？",
      "rationale": "否認経路が業務上未定義です。",
      "suggestedAnswers": [
        "申請者へ戻す",
        "直前の承認者へ戻す",
        "処理を終了する"
      ]
    }
  ]
}
```

These findings can be rendered as overlays without parsing free-form text.

## Following slice: semantic operations

Codex may propose changes, but application goes through a constrained operation set.

```text
add_node
update_node
remove_node
add_edge
remove_edge
assign_lane
set_edge_condition
```

Example:

```json
{
  "op": "add_node",
  "after": "Task_OfficeApproval",
  "node": {
    "id": "Task_IntegratedManagerApproval",
    "type": "userTask",
    "name": "統合管理責任者が確認"
  }
}
```

The server applies operations to a cloned Logic-Core document, runs the JSON Schema gate and deterministic rules, generates BPMN, and only then offers the revision to the user for review/apply.

The semantic-operation executor is an application service, not a Codex filesystem-edit operation. This keeps BPMN edits auditable and prevents the agent from bypassing Logic-Core validation.

## Later integrations

- streaming `item/agentMessage/delta` into the right pane
- approval/request UI if future Codex tools genuinely require it
- role/policy references outside BPMN, keyed by BPMN element ID
- OPA/Policy-as-Code consistency checks
- Git diff review for BPMN + Logic-Core + policy changes
- task mapping (`userTask -> kintone`, `serviceTask -> Dagu/external workflow runtime`, `businessRuleTask -> policy engine`)
- unresolved grilling findings stored alongside the process as review metadata
