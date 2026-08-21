# Adopt Kumo UI with As-Code Studio theme

Status: closed — Kumo foundation adopted and adapter smoke verified
Date: 2026-08-21
Target: As-Code Studio browser shell

## Goal

Adopt Cloudflare Kumo as the browser UI component/design-system layer while preserving the current As-Code Studio visual character.

The migration direction is **Kumo behavior/accessibility + As-Code Studio theme**, not a visual redesign toward Kumo defaults.

## Context

The current browser UI is intentionally simple:

- white / neutral surfaces
- thin 1px borders instead of card-heavy elevation
- restrained border radius
- minimal shadows
- native-feeling controls
- compact workbench density
- primary color used sparingly for important actions

This visual language should remain the baseline.

Kumo provides reusable accessible React components, including Button, Input, Select, Toolbar, Sidebar, Dialog, Tabs, Tooltip, Empty and other primitives. It supports semantic theme tokens and a standalone stylesheet for non-Tailwind consumers.

As-Code Studio currently uses Vanilla HTML/CSS/JS. Introducing Kumo therefore also introduces React at the browser shell/component boundary.

## Architecture direction

```text
React + Kumo
  |
  +-- As-Code Studio shell/theme
  |    +-- toolbar / controls
  |    +-- sidebar / navigation
  |    +-- inspector / findings
  |    +-- dialogs / transient UI
  |
  +-- Artifact viewport boundary
       +-- BPMN runtime (lazy)
       +-- Mermaid runtime (lazy)
       +-- OPA UI/runtime
       +-- Dagu UI/runtime
```

Adapter semantic/runtime boundaries remain unchanged. React/Kumo is a presentation-shell concern and must not make adapters depend on each other.

## Theme policy

Create an As-Code Studio theme that maps Kumo semantic tokens to the current UI before replacing existing controls.

Baseline values should be derived from the current CSS, including approximately:

- canvas/base: `#ffffff`
- app background: `#f3f4f6`
- recessed/subtle surface: `#f8fafc`
- normal border: `#d1d5db`
- subtle border: `#e2e8f0`
- default text: `#1f2937`
- muted text: `#6b7280`
- primary/action: `#1d4ed8`
- compact radius: approximately `6px`

Do not reproduce these values by scattering raw colors through React components. Theme/token overrides are the canonical visual contract.

## Component policy

Prefer Kumo styled components when an appropriate component exists.

Use granular Kumo imports where practical to preserve tree-shaking.

When As-Code Studio needs a higher-level application pattern:

1. compose existing Kumo components first;
2. use a Kumo/Base UI primitive when behavior is reusable but no styled Kumo component fits;
3. define an As-Code Studio pattern/component only when the requirement is application-specific or genuinely missing from Kumo.

Examples:

- `SessionHistory` is an As-Code Studio pattern.
- collapsible sidebar behavior should use Kumo `Sidebar`, not a new home-grown sidebar primitive.
- artifact-specific inspector/findings semantics remain application-level concerns.

## Initial implementation scope

### Phase 1 — foundation

1. Add React / React DOM / Kumo and required peer dependencies.
2. Add the appropriate Vite React integration if required.
3. Import Kumo standalone styles; do not introduce Tailwind solely for this migration.
4. Define As-Code Studio theme/token overrides matching the current UI.
5. Establish a React root for the application shell without breaking lazy adapter runtimes.

### Phase 2 — shell primitives

Migrate a minimal set of existing controls first:

- primary/secondary buttons
- select/input controls where Kumo fits cleanly
- toolbar/shell presentation

Keep the visual result intentionally close to the current application.

### Phase 3 — application patterns

After the foundation is stable, add new patterns as needed. The first expected pattern is a collapsible left session-history column using Kumo `Sidebar`.

## Lazy-loading constraint

The recently introduced adapter runtime lazy-loading must remain intact:

- no eager `bpmn-js` import in the shell entry
- Mermaid remains dynamically imported
- OPA/Dagu browser runtime remains load-on-use where applicable
- adopting React/Kumo must not collapse adapter chunks back into the initial bundle

Kumo components should use granular imports where that materially reduces the entry bundle.

## Migration strategy

Prefer incremental migration over a full rewrite.

The first implementation should establish React/Kumo/theme infrastructure and migrate enough shell UI to prove the approach. Existing imperative adapter code may continue to operate against stable DOM mount points during the transition.

Avoid rewriting BPMN/Mermaid/OPA/Dagu logic merely to make it stylistically React-like.

## Non-goals

- redesigning As-Code Studio to match Cloudflare dashboard visuals
- migrating all adapter/runtime logic to React
- introducing Tailwind as an application styling dependency unless later justified
- creating a comprehensive As-Code Studio component library up front
- replacing Kumo components with local equivalents without a concrete need

## Acceptance criteria

- [x] React and Kumo are installed and build successfully.
- [x] Kumo standalone styling is integrated without requiring Tailwind configuration.
- [x] As-Code Studio theme overrides preserve the current neutral/minimal visual character.
- [x] At least representative shell controls use Kumo components.
- [x] Existing BPMN / Mermaid / OPA / Dagu functionality remains usable.
- [x] BPMN and Mermaid lazy-loading behavior remains intact.
- [x] production build succeeds.
- [x] tests succeed.
- [x] no new lint errors are introduced.
- [x] migration remains incremental; adapter semantics are not coupled to React/Kumo.

## Future follow-up

Implement a collapsible left session-history column using Kumo `Sidebar` after the Kumo foundation/theme is stable. Session history itself remains an As-Code Studio application pattern rather than a design-system primitive.

## Completion evidence

Foundation adoption is complete. A headless Chrome smoke pass on 2026-08-21 switched through BPMN, Mermaid, OPA, Dagu, and Bonita BDM from the shared adapter selector; every adapter selected successfully, its pane was visible, and no browser runtime exception was observed.

New application patterns such as session history are separate product work and should not keep this foundation issue open indefinitely.

## Implementation progress — 2026-08-21

Foundation implementation started after the issue-only commit.

- Installed `@cloudflare/kumo@2.11.0`, `react@19.2.8`, `react-dom@19.2.8`, and `@phosphor-icons/react@2.1.10` through Vite+ package management.
- Added `kumo-bootstrap.jsx` as an incremental React island/bootstrap boundary. It renders Kumo controls first and then imports the existing imperative `main.js`.
- Added an `as-code-studio` Kumo theme mapped to the existing neutral palette and compact radius.
- Migrated representative shell buttons (New Artifact, AI session reset, ChatGPT login, Validate, Format, AI Generate) to granular Kumo `Button` imports.
- Kumo standalone CSS is used; Tailwind was not added to the application.
- Headless Chrome confirms the Kumo buttons and BPMN canvas render in the running dev application.
- Adapter lazy-loading remains split in the production build.

### Bundle observation

The Kumo/React foundation has a measurable initial-load cost. Before Kumo, the post-lazy-loading entry was approximately `50.66 kB` JS and `8.42 kB` CSS. With the current React + Kumo Button + standalone CSS foundation, the main entry is approximately `332.93 kB` JS (`107.44 kB` gzip) and `140.12 kB` CSS (`22.46 kB` gzip).

This does not re-eager-load BPMN, Mermaid, OPA, or Dagu runtimes, but the shell cost should be considered before broad component migration. Keep granular Kumo imports and measure each expansion.
