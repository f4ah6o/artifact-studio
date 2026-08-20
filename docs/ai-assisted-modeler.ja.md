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
Artifact Studio HTTP server
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
  -> thread/start
  -> turn/start
  -> item/* notifications
  -> turn/completed
```

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
