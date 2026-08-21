# AI-assisted BPMN Modeler

[English](ai-assisted-modeler.md)

## Goal

BPMNを、人間の編集、deterministic validation、Codex-assisted discovery/reviewで共有できるinteractive business-process modelとして扱う。

browser editorをbusiness ruleのauthorityにはしない。browserで編集したBPMNはserverでLogic-Coreへ戻し、deterministicにvalidateし、同じsemantic modelをCodexにも渡す。

## AI runtime: Codex app-server

web applicationはLLM APIをbrowserから直接呼ばない。Codex app-serverがAI runtimeとなり、model/auth/sessionを管理する。

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

現在はdefaultのstdio transportを使う。app-server WebSocket transportはMVPの必須dependencyにしない。

client lifecycle:

```text
spawn codex app-server
  -> initialize
  -> initialized
  -> account/read
  -> model/list
  -> thread/start (新しいArtifact AI work session)
     OR thread/resume (継続work session)
  -> turn/start (current model / reasoning effort)
  -> item/* notifications
  -> turn/completed
```

Codex runtime metadataはcanonical artifact contentと分離する。browserへ保存するのはArtifact work sessionごとのopaqueな `aiSessionId` と選択中model/effortだけで、raw Codex `threadId` はserver側だけに保持する。page reloadでは同じwork-session identityを再利用し、別Artifactへ切り替えると別sessionを解決する。外部fileでartifact内容を置き換えた場合は新しいwork-session identityを開始する。

model selectorはapp-serverの `model/list` から構築する。advertised default modelと各modelの `defaultReasoningEffort` / `supportedReasoningEfforts` をauthorityとし、`CODEX_MODEL` / `CODEX_EFFORT` はdeployment/bootstrap overrideとして残す。UIでmodel/effortを変更すると次の `turn/start` 以降へ反映し、app-server processは再起動しない。

既存work sessionでは `thread/resume` を試す。Codexがpersist済みrolloutの消失を返した場合だけ新しいthreadへ回復し、context resetをsafeなAI-session statusへ出す。browserからraw `threadId` を入力・注入するAPIにはしない。

browser UIのChatGPT loginは `account/login/start` (`type: chatgpt`) から開始し、返されたauthorization URLをbrowserで開く。BPMN UIにOpenAI API key入力欄を持たせない。

## Deployment scope

現MVPはsingle-user/local app-server processを前提とする。shared central deploymentで複数userを同一Codex account/sessionへmultiplexしてはいけない。multi-user化する場合はapp-server state/authをuserごとにisolateする。

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

`/api/v1/chat` はcurrent Logic-Coreをcontextとしてgrilling workflowを支援するが、LLMがBPMN XMLを直接mutateする構成にはしない。

## Design rules

1. Codex app-serverをAI boundaryとし、browser codeにmodel-provider credentialを持たせない。
2. LLMに座標を書かせず、layoutはdeterministic pipelineへ任せる。
3. LLMにBPMN XMLを直接patchさせず、semantic operationとして変更を表す。
4. AI reviewより先にdeterministic validationを実行する。
5. findingは可能な限りBPMN element IDへgroundする。
6. manual BPMN editは `bpmn-js -> saveXML -> /import -> /validate` でLogic-Coreへround-tripする。
7. core editingをexperimental dynamic toolsへ依存させない。
8. このworkflowでのCodex executionはread-onlyとし、command/file-write requestをauto-approveしない。

## Current MVP

- editable `bpmn-js` modeler
- `/api/v1/orchestrate` によるnatural-language generation
- stdio Codex app-server adapter
- Artifact scoped Codex thread continuationと明示的AI-session reset
- app-server `model/list` driven model/reasoning-effort controls
- app-server経由ChatGPT managed login
- `.bpmn` import/export
- edit後のBPMN -> Logic-Core synchronization
- deterministic validation findings
- element IDに基づくoverlay
- selected-element inspection
- current Logic-CoreをcontextにしたCodex grilling

## Structured findings / semantic operations

review resultはfree-form textだけでなく、`turn/start.outputSchema` でconstrainしたstructured findingsとして扱えるようにする。変更を適用する場合も `add_node`, `update_node`, `remove_node`, `add_edge`, `remove_edge`, `assign_lane`, `set_edge_condition` 等のconstrained operation setを通す。

serverはcloneしたLogic-Coreへoperationを適用し、JSON Schema gateとdeterministic rulesを通し、BPMNを生成した後にhuman reviewへ提示する。agentがfilesystem editでvalidationを迂回できない構造を維持する。

将来integrationはREADMEではなく `docs/` / `issues/` で管理する。
