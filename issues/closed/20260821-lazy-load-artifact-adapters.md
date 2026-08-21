# Lazy-load Artifact Adapter Runtimes

Status: closed
Date: 2026-08-21
Target: Artifact Studio browser runtime

## Goal

Artifact Studio の初期ロードから adapter 固有の重量runtimeを分離し、実際にその adapter / view / capability を使うまで読み込まない。

特に `bpmn-js` と `mermaid` は browser bundle が大きいため、adapter registry の metadata と runtime implementation を分離する。

## Current state

- Mermaid runtime は `import('mermaid')` により既に lazy-load されていた。
- BPMN runtime は `src/client/main.js` から `bpmn-js/lib/Modeler` を static import しており、BPMNを使わない場合でも初期entry bundleへ含まれていた。
- OPA / Dagu の graph preview は generic graph renderer 経由で Mermaid を利用するため、previewを実際に表示する時点で Mermaid をloadすればよい。
- adapter metadata (`id`, `label`, `accept`, capability declarations等) は軽量なまま同期的に参照できる必要がある。

## Design

### Lightweight registry

起動時に必要なのは adapter の metadata のみとする。

```text
Artifact Studio shell
  -> lightweight adapter registry
       - id
       - label
       - accept
       - contentKind
       - capabilities
       - runtime loader
```

### Lazy runtime

重量runtimeは capability 実行時またはview activation時に dynamic import する。

```text
select/open BPMN
  -> import('./bpmn-runtime.js')
       -> import('bpmn-js/lib/Modeler')

render/validate Mermaid
  -> import('mermaid')
```

同一runtimeは Promise をcacheし、2回目以降は再importしない。

OPA / Dagu の browser extension も adapter activation 時の dynamic import に変更した。

### Boundaries

- adapter core metadata と runtime implementation を分離する。
- adapter間の直接依存は追加しない。
- GraphProjection -> Mermaid rendering は既存generic renderer boundaryを維持する。
- HTTP/server adapter integrationとは独立したbrowser optimizationとする。
- UI semanticsやworkspace persistence formatは変更しない。

## Implementation

1. BPMN Modeler生成・日本語translation・BPMN CSS importを `src/client/bpmn-runtime.js` へ分離。
2. `main.js` の top-level `bpmn-js` static importを除去。
3. BPMN activation時に `import('./bpmn-runtime.js')` し、Promiseをcache。
4. Mermaidの既存 `import('mermaid')` lazy-loadを維持。
5. OPA / Dagu extensionを `index.html` の eager module entryから除外し、adapter activation時にdynamic import。
6. lazy-loading boundaryのregression testを追加。

## Non-goals

- adapter plugin systemの全面再設計
- server-side adapterのdynamic discovery
- user-installable adapter marketplace
- arbitrary remote module loading
- Mermaid内部のdiagram type単位の独自code splitting

## Acceptance criteria

- [x] `src/client/main.js` に `bpmn-js` のstatic importがない
- [x] BPMNを使用するまでBPMN Modeler runtimeをloadしない
- [x] Mermaidは使用時loadのままである
- [x] BPMN / Mermaid / OPA / Daguの既存操作が回帰しない
- [x] 全testが成功する
- [x] production buildが成功する
- [x] build outputでBPMN runtimeがentry chunkから分離される
- [x] 初期entry chunk sizeが変更前より有意に減少する

## Verification baseline

統合HTTP変更後の直近buildでは main entry chunk が約 `645.14 kB`、Mermaid関連はdynamic chunksとして別出力されていた。

## Verification result

- `vp check`: exit 0。repository既存のwarningは残るがerrorは0。
- `vp test --run`: 419 passed, 1 skipped。
- `vp build`: success。
- Main entry chunk: 約 `645.14 kB` → `50.66 kB`（約92%削減）。
- BPMN runtime: `bpmn-runtime-*.js` 約 `576.06 kB` + `bpmn-runtime-*.css` 約 `27.53 kB` として分離。
- OPA extension: 約 `11.16 kB` のlazy chunk。
- Dagu extension: 約 `7.67 kB` のlazy chunk。
- Mermaidは引き続き `import('mermaid')` 経由でlazy-loadされ、Mermaid関連chunkはinitial entryから分離されている。
