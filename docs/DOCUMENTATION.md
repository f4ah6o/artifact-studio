# Documentation policy

[日本語](DOCUMENTATION.ja.md)

## Purpose of each location

- `README.md` / `README.ja.md`: current, user-facing behavior that can be verified from the present codebase.
- `docs/`: maintained architecture, operation, compatibility, and implementation documentation.
- `issues/open/`: active proposals, design decisions that still need implementation, and scoped work items.
- `issues/closed/`: completed work with completion evidence and the revision that implemented it.
- `THIRD-PARTY-NOTICES.md`: upstream attribution and dependency-license information.

README files are not a roadmap and should not accumulate future plans, historical design discussions, stale benchmarks, or third-party license inventories.

## English and Japanese pairs

New or materially updated maintained human-facing documents should have an English file and a Japanese companion using the same basename:

```text
docs/FEATURE.md
docs/FEATURE.ja.md
```

The same convention applies to the root README:

```text
README.md
README.ja.md
```

When a maintained document changes materially, update both language versions in the same change. Japanese technical documentation may retain established English identifiers, command names, API names, and code terms where translating them would reduce precision.

Historical design records under paths such as `docs/superpowers/specs/` are snapshots and do not need retroactive translation unless they become maintained documentation again.

## Design and implementation workflow

1. Put non-trivial future design work in `issues/open/` or a maintained `docs/` design document.
2. Keep README statements limited to implemented behavior.
3. Implement and verify the change.
4. Update maintained English/Japanese documentation together.
5. Move completed issue files to `issues/closed/` with completion evidence instead of leaving implemented work in `issues/open/`.
