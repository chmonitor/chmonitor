# What's new notes

Short, human-readable notes for the in-dashboard **What's new** dialog and the
landing `/changelog` page. GitHub Releases stay the detailed changelog (recap
stats, Docker, full commit list). Do not rewrite GitHub Release bodies.

## File per version

`docs/whats-new/vX.Y.Z.md`:

```md
---
version: 0.3.3
date: 2026-08-16
summary: Guest AI caps, simpler alerts, and pinned favorites you can drag.
screenshots:
  - /assets/whats-new/v0.3.3-nav.png
  - src: /assets/screenshots/overview-dark-with-bg.jpeg
    alt: Overview heatmap
---

- Cap and track guest AI usage on Cloud.
- Alert settings use templates and presets.
- Drag to reorder pinned favorites.
```

Rules: no commit SHAs, no PR-number walls, no recap stats, no agent shoutouts,
no Docker pull blocks. 4–8 user-facing bullets. Screenshots are optional.

## Screenshots

Put image files in repo-root `assets/whats-new/` (same shared library as
`assets/screenshots/`). `scripts/sync-shared-assets.mjs` copies them to
`/assets/<category>/<file>` on landing, docs, and blog.

Frontmatter paths should be site-root URLs (`/assets/whats-new/…` or
`/assets/screenshots/…`). The dashboard rewrites those to
`https://chmonitor.dev/assets/…` so the dialog can load them. Do not invent
screenshot files — omit `screenshots` until a real capture exists.

## Fallback

If a version has no file, both UIs strip the GitHub Release body down to
Features / Fixes / Perf (and drop recap / Docker / shoutouts).

## After a dashboard release

`release.yml` generates or updates `docs/whats-new/vX.Y.Z.md` from the detailed
release notes plus any `## [Unreleased] ### Highlights` in `CHANGELOG.md`. It
does not replace the GitHub Release body. You can also run:

```bash
bun scripts/write-whats-new.ts --tag v0.3.4
```
