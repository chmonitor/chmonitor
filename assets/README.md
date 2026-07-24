# Shared image library

Committed source of truth for images reused across the marketing/docs sites
(`apps/landing`, `apps/docs`, `apps/blog`).

- `screenshots/` — product screenshots (dashboard captures, dialogs), both
  `-light`/`-dark` variants where available.
- `illustrations/` — bespoke brand illustrations (spot art, hero graphics) as
  static `.svg`/`.png`, both `-light`/`-dark` variants where a single
  `currentColor`-driven file can't serve both themes. **In-app** (the dashboard)
  prefer inline React SVG illustration components
  (`apps/dashboard/src/components/illustrations/`) — they are theme-aware and
  token-driven (OKLCH `--chart-*` palette via Tailwind utilities, brand orange /
  emerald) and motion-safe. Use this `illustrations/` folder for the static
  marketing/docs sites, which can't import the dashboard's React components.

`scripts/sync-shared-assets.mjs` copies this directory into each app's
`public/assets/` (gitignored) as a predev/prebuild step, so every site serves
the same files at `/assets/<category>/<file>`, e.g.
`/assets/screenshots/overview-dark.png`.

Conventions:

- Name files descriptively after the feature/page they show
  (`peerdb-mirrors-dark.png`, `add-pg-source-light.png`) — never raw capture
  names like `SCR-*.png`.
- Add new files here, never directly to an app's `public/` — they would be
  deleted by the sync's stale-file cleanup.
- The landing site 301-redirects the old `/landing-assets/*` URLs to
  `/assets/screenshots/*` (see `apps/landing/public/_redirects`).
