---
id: og-images
type: spec
related: [deployment, conventions]
tags: [seo, og, social, satori, static]
---

# Open Graph (OG) Images

Social-share preview images (1200×630) for landing, docs, blog, and dashboard.

## How it works

One compositor — [`scripts/og-builder.ts`](../../scripts/og-builder.ts) — paints
the Bayer-dune plate (`assets/og/dunes-*.jpg`) and overlays type with **resvg**.
The **title is always centered**. The wordmark sits **top-left** (product pages)
or **bottom-right** (blog / release / version) so the title stays the hero.

Canonical plate is **08 Master dunes** (`assets/og/dunes-landing.jpg`) for
landing, docs, blog, and dashboard. White type on the zinc sky; logo top-left
(product) or bottom-right (blog/release).

- Landing + features: `cd apps/landing && pnpm run build:og`
- Blog + releases: `cd apps/blog && pnpm run build:og`
- Docs home + dashboard pages: `pnpm run og:generate`

The PNGs are **regenerated automatically on every Cloudflare deploy** and also
committed to each app's `public/` dir:

- **CI deploy** (`.github/workflows/cloudflare.yml`) — each of the `dashboard`,
  `landing`, and `docs` jobs runs a "Generate OG images" step (root install +
  `pnpm run og:generate`) before the app build, so the deployed image always
  matches the current template. The step runs at repo root because the
  generator's deps live in the root workspace, not in the standalone apps.
- **Committed PNGs** — serve as the baseline for local dev and the build-check
  workflows (`landing.yml` / `docs.yml`), which don't run the generator. Keep
  them in sync by running `pnpm run og:generate` and committing after template
  changes.

## Outputs

| File | Used by |
|------|---------|
| `apps/landing/public/og/og.png` | Landing (`chmonitor.dev`) |
| `apps/docs/public/og/og.png` | Docs (`docs.chmonitor.dev`) |
| `apps/dashboard/public/og/og.png` | Dashboard default |
| `apps/dashboard/public/og/og-<slug>.png` | One per entry in the OG registry (`overview`, `clusters`, `explorer`, `agents`, `running-queries`, `history-queries`, `failed-queries`, `slow-queries`, `expensive-queries`, `merges`, `mutations`, `tables`, `replicas`, `settings`, `users`, `query-cache`, `backups`, `disks`) |

Pages without a registry entry fall back to the dashboard default `og/og.png` via
the `__root.tsx` base tags.

## Meta wiring

- **Landing** — `apps/landing/src/layouts/Base.astro` (`image` prop, default
  `/og/og.png`; absolute URL via `Astro.site`).
- **Docs** — `apps/docs/src/layouts/MainLayout.astro`.
- **Dashboard** — base tags in `src/routes/__root.tsx`; per-page `og:title` /
  `og:image` / `twitter:image` come from `pageOgHead('<slug>')` in each route's
  `head()`. Both the image and the meta read from the same registry, so they
  cannot drift. Verified statically: the tags are baked into the prerendered
  `dist/client/<route>/index.html` (crawlers see them without running JS).

All use `twitter:card = summary_large_image` so the full banner renders.

## Single source of truth: the OG registry

`apps/dashboard/src/lib/og.ts` exports `OG_PAGES` (`slug → {eyebrow, title,
description, headTitle?}`) plus `pageOgHead(slug)`. It feeds **two** consumers:

1. `scripts/generate-og-images.ts` imports `OG_PAGES` and renders one
   `og-<slug>.png` per entry (the standalone bun script can import the TS file
   directly — keep `og.ts` free of React / `@/` alias imports).
2. Route files call `head: () => pageOgHead('<slug>')`.

## Editing / adding a card

- **Dashboard page** — add an entry to `OG_PAGES` in `apps/dashboard/src/lib/og.ts`
  and `head: () => pageOgHead('<slug>')` in the route, then `pnpm run og:generate`
  and commit the PNG.
- **App-level cards** (landing, docs, dashboard home) — edit the `CARDS` array in
  `scripts/generate-og-images.ts`.

Brand palette (amber `#f59e0b` → orange `#f97316` on zinc `#09090b`) mirrors the
landing `Base.astro` `:root` tokens.
