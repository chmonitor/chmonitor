# chmonitor blog

The chmonitor blog — release notes and product updates — served at
[blog.chmonitor.dev](https://blog.chmonitor.dev).

A plain **Astro** static site (no React/SSR) that reuses the same black/white/
orange design tokens as `apps/landing`, so the marketing site, blog and docs feel
like one product. Posts are Markdown in `src/content/blog/` validated by the
content-collection schema in `src/content.config.ts`.

## Develop

```bash
cd apps/blog
bun install
bun run dev        # http://localhost:4321
```

## Add a post

Create `src/content/blog/<slug>.md` with frontmatter:

```yaml
---
title: "Post title"
description: "One-line summary used for the card + social preview."
date: 2026-06-29
tag: Release          # shown on the card when `version` is absent
version: v0.3         # optional — shown instead of `tag`
cover: /brand/og-brand.png   # optional OG image
draft: false          # optional — true hides it from the build
---
```

The post URL comes from the `version` frontmatter when set (e.g. `version: v0.3` → `/v0.3/`), falling back to the file slug otherwise. See `src/lib/slug.ts`.

### Embedding video

Drop the MP4 under `public/posts/<version>/` and embed it with raw HTML in the
Markdown (Astro renders raw HTML in `.md`):

```html
<figure class="video">
  <video src="/posts/v0.3/launch.mp4" poster="/posts/v0.3/launch-poster.png" controls preload="metadata" playsinline></video>
  <figcaption>Caption…</figcaption>
</figure>
```

Launch films live in `chmonitor/launch/<version>/` and are copied into
`public/posts/<version>/` for the release post.

## Content engine

- **Calendar**: `CONTENT-CALENDAR.md` is the plan-of-record for cadence (12
  weeks, mixing release/how-to/troubleshooting/case-study posts). Update its
  status column as posts move from planned → drafting → done.
- **Templates**: `templates/*.md` (one per post type) live outside
  `src/content/blog/` so the content-collection glob never picks them up as
  posts. Each ends with a claim-verification checklist — every feature/config
  claim in a post must be checked against merged code before `draft: false`.
- **Docs↔blog cross-linking**: a how-to/troubleshooting/case-study post links
  the canonical docs page it walks through (`https://docs.chmonitor.dev/<slug>`,
  matching `docs/content/**` paths 1:1); the docs page links back with a
  `[Post title](https://blog.chmonitor.dev/<slug>/)` reference. Bidirectional
  by convention — see `alerting-to-slack-and-discord.md` ↔
  `docs/content/guide/features/health.mdx` for the reference pair.
- **RSS**: `src/pages/rss.xml.ts` (via `@astrojs/rss`) builds `/rss.xml` from
  the same content collection as the post list; linked from `Base.astro`'s
  `<head>` and the footer.
- **Release → draft post**: `bun run release-to-post <tag>` (fetches via `gh
  release view`, or `-- --from-file <json>` for offline/CI use) scaffolds a
  `draft: true` post from `templates/release-post.md`. It never publishes —
  a human still runs the claim-verification checklist and flips `draft` to
  `false`.
- **Landing footer widget**: `apps/landing` is a separate Astro app with its
  own CI job, so it can't reach into this app's content collection at build
  time. `bun run sync-latest-posts` regenerates a committed snapshot at
  `apps/landing/src/data/latest-posts.json` (published, non-draft posts,
  newest first) that `Footer.astro` renders as "Latest from the blog". Run it
  after publishing and commit the snapshot alongside the post.

## Deploy

```bash
cd apps/blog
bun run build
wrangler deploy            # → chmonitor-blog worker, blog.chmonitor.dev
```

Static-assets-only Worker (no `main`). Production is `blog.chmonitor.dev`; the
`preview` env is `preview.blog.chmonitor.dev`.
