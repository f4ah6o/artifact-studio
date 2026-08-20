# Third-Party Notices

This file is the repository's home for upstream attribution and third-party license information. README files intentionally do not duplicate dependency-license tables or historical licensing notes.

Versions below reflect the current pnpm lock/install at the time this notice was updated. `scripts/pnpm-lock.yaml` is authoritative for exact resolved dependency versions.

## Original BPMN Generator code

Artifact Studio contains and extends code whose repository history began as **BPMN Generator**.

- Original project: `dstiegler/bpmn-generator`
- Original code copyright: Copyright (c) 2026 Daniel Stiegler
- License: MIT
- License text retained in this repository: [`LICENSE`](LICENSE)

The original MIT notice is preserved. Subsequent Artifact Studio modifications are distributed under the repository's MIT license unless a file or dependency states otherwise.

## Runtime dependencies

### @modelcontextprotocol/sdk

- Resolved version: 1.30.0
- License: MIT
- Author: Anthropic, PBC
- Project: https://github.com/modelcontextprotocol/typescript-sdk
- Use: MCP server protocol implementation

### ajv

- Resolved version: 8.20.0
- License: MIT
- Author: Evgeny Poberezkin
- Project: https://github.com/ajv-validator/ajv
- Use: JSON Schema validation

### ajv-formats

- Resolved version: 3.0.1
- License: MIT
- Author: Evgeny Poberezkin
- Project: https://github.com/ajv-validator/ajv-formats
- Use: standard JSON Schema format validation for Ajv

### bpmn-js

- Resolved version: 18.24.0
- License: license text shipped by `bpmn-js` (MIT-style terms plus the bpmn.io watermark condition)
- Copyright: Copyright (c) 2014-present Camunda Services GmbH
- Project: https://github.com/bpmn-io/bpmn-js
- Use: browser BPMN modeler / renderer

The `bpmn-js` license requires the bpmn.io project watermark source and rendered watermark to remain intact and visible when used in a website or application. Artifact Studio must not remove, change, or visually cover that watermark.

The complete dependency license is available in the installed package as `bpmn-js/LICENSE` and in the upstream repository.

### bpmn-js-i18n

- Resolved version: 2.4.0
- License: MIT
- Author: Nico Rehwaldt
- Project: https://github.com/bpmn-io/bpmn-js-i18n
- Use: bpmn-js translations

### bpmn-moddle

- Resolved version: 10.1.0
- License: MIT
- Author: Nico Rehwaldt / bpmn.io contributors
- Project: https://github.com/bpmn-io/bpmn-moddle
- Use: BPMN 2.0 meta-model, XML parsing, and serialization

### elkjs

- Resolved version: 0.11.1
- License: Eclipse Public License 2.0 (EPL-2.0)
- Project: https://github.com/kieler/elkjs
- Use: deterministic graph layout for BPMN

Artifact Studio consumes ElkJS as a dependency and does not relicense ElkJS code under MIT. EPL-2.0 terms continue to apply to ElkJS itself.

### mermaid

- Resolved version: 11.16.0
- License: MIT
- Author: Knut Sveidqvist and contributors
- Project: https://github.com/mermaid-js/mermaid
- Use: Mermaid parsing/rendering and graph projection rendering

## Development dependencies and toolchain

### bpmn-auto-layout

- Resolved version: 1.3.0
- License: MIT
- Copyright / author: bpmn.io contributors
- Project: https://github.com/bpmn-io/bpmn-auto-layout
- Use: development comparison / evaluation only

### Vite+

The project uses Vite+ for install, development, checking, testing, and builds.

- `vite-plus` resolved version: 0.2.9
- `vite` catalog target: `@voidzero-dev/vite-plus-core` 0.2.9
- License: MIT
- Author: VoidZero Inc.
- Project: https://github.com/voidzero-dev/vite-plus

Vite+ bundles or resolves additional development tools and transitive dependencies. Their own license terms remain applicable; consult `scripts/pnpm-lock.yaml` and the installed packages for the complete transitive dependency set.

## Standards and references

The repository implements and documents behavior related to BPMN 2.0 and cites external books, papers, specifications, and projects. A citation or compatibility target does not imply that the cited work is incorporated into Artifact Studio or relicensed under MIT.

In particular, OMG BPMN specifications and ISO/IEC publications remain subject to their respective copyright and distribution terms.
