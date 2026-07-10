# Plan 92: Add the missing blog OG image and resolve the duplicate slow-query posts

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/blog`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs / SEO
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2509

## Why this matters

1. The post `find-slow-clickhouse-queries` has a **broken social-share card**:
   the template points `og:image` and BlogPosting JSON-LD at
   `/og/blog/find-slow-clickhouse-queries.png`, which does not exist in
   `apps/blog/public/og/blog/` (all 8 series posts have theirs).
2. Two posts target the same search intent — "find slow queries via
   system.query_log": `find-slow-clickhouse-queries.md` (How-to, 2026-07-10)
   and `clickhouse-slowest-queries-system-query-log.md` (series, 2026-07-01) —
   with no cross-link or canonical, splitting ranking signal.

## Current state

- Template refs: `apps/blog/src/pages/[...slug].astro` lines ~31 (og:image)
  and ~63 (JSON-LD image) build the URL from the slug.
- `ls apps/blog/public/og/blog/` → the 8 series PNGs + `index.png` + `v0.3.png`;
  no `find-slow-clickhouse-queries.png`.
- How the existing OG images were generated: check for a generator script
  (`rg -n "og" apps/blog/package.json scripts/ apps/blog/scripts/ --max-count 20`)
  — the docs app has `generate-og` in its build; the blog may have an
  equivalent or the PNGs may be committed artifacts of a one-off script.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Blog build | `cd apps/blog && pnpm install && pnpm run build` | exit 0 |

## Scope

**In scope**: the missing OG PNG; frontmatter/cross-link edits to the two
posts (canonical or "part of the series" links).

**Out of scope**: deleting either post (editorial call — see Step 2 decision
rule); redesigning OG templates; other posts.

## Git workflow

- Branch: `advisor/92-blog-og-duplicate-post`
- Commit: `fix(blog): add missing OG image, cross-link duplicate slow-query posts`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Generate the missing OG image
Use the same generator that produced the series PNGs (found in recon of
Step "Current state"). If the generator is discoverable and runnable, run it
for this slug; if the PNGs were hand-made one-offs, copy the visual pattern of
a series PNG with the post's title (any scripted raster approach matching
dimensions of the existing files — check `sips -g pixelWidth -g pixelHeight`
on an existing one).
**Verify**: `test -f apps/blog/public/og/blog/find-slow-clickhouse-queries.png && echo OK` → OK; dimensions match siblings; blog build green.

### Step 2: Differentiate + cross-link the two posts
Decision rule (no user input available): keep BOTH, differentiate: the series
post stays the canonical "5-minute" intro; the standalone how-to is the deep
version. Add to each post's frontmatter/body: a prominent link to the other
("Prefer the 5-minute version?" / "Want the full walkthrough?"), and align
their titles so they don't read identically in SERPs (edit the how-to's
frontmatter `title`/`description` to emphasize depth, e.g. "…: a complete
walkthrough"). If the blog supports a `canonical` frontmatter field
(check the slug template), do NOT set cross-canonicals — they're different
enough once differentiated.
**Verify**: both posts render with the cross-link (build + grep each file for the other's slug).

## Done criteria

- [ ] OG PNG exists and the built page's `og:image` resolves
- [ ] Both posts cross-link and have distinct titles/descriptions
- [ ] Blog build green; `plans/README.md` updated

## STOP conditions

- The maintainer's content calendar (`apps/blog` content-calendar file, synced
  recently) marks one of the two for deletion/merge — follow it and report
  instead of the Step 2 default.

## Maintenance notes

- Add-a-post checklist should include "OG image generated" — if a generator
  script exists, wiring it into the blog build (like apps/docs `generate-og`)
  is the durable fix; note as follow-up in the PR.
