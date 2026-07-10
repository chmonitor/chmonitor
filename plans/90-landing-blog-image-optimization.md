# Plan 90: Optimize landing + blog images (theme pairs, formats, dimensions)

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/landing/src apps/blog/src`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (theme swap must not flash; visual check both themes)
- **Depends on**: none
- **Category**: perf (landing/blog)
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2507

## Why this matters

Three compounding image costs on the marketing surfaces:

1. **Double downloads**: every landing screenshot is TWO sibling `<img>`s
   (light + dark variants); CSS hides one but both are in the DOM and both
   fetch when scrolled into view (`loading="lazy"` doesn't help hidden-by-CSS
   siblings in practice). Individual PNGs run 200–390 KB — a 5-screenshot
   section wastes ~1 MB on the theme the visitor never sees.
2. **Unoptimized formats**: zero `astro:assets` usage in `apps/landing`; all
   screenshots are raw `/public` PNGs (~7.9 MB total), no AVIF/WebP conversion,
   no responsive `srcset`.
3. **Blog CLS**: `apps/blog/src/content/blog/chmonitor-v0-3.md` (~lines 75-162)
   has ~20 raw `<img>` tags with no `width`/`height` and no `loading="lazy"`.

## Current state

- Paired imgs: `apps/landing/src/components/Insights.astro` (lines ~12-13,
  26-27, 30-31, 45-46, 56-57), `Features.astro` (~85-86),
  `DataExplorer.astro` (~12-13) — pattern
  `<img data-shot="light" ...>` + `<img data-shot="dark" ...>`; CSS hiding in
  `layouts/Base.astro` (~line 278). The theme toggle stamps a theme attribute
  (read `Base.astro` for the exact mechanism before changing anything).
- No `astro:assets`/`<Image` anywhere in `apps/landing/src` (grep-verified).
- Largest assets: `apps/landing/public/landing-assets/peerdb-mirrors.png`
  (~390 KB), `slow-queries.png` (~350 KB).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Landing build | `cd apps/landing && pnpm install && pnpm run build` | exit 0 |
| Blog build | `cd apps/blog && pnpm install && pnpm run build` | exit 0 |
| Landing preview | `cd apps/landing && pnpm run preview` | serves site |

## Scope

**In scope**: the three landing components + `Base.astro` theme-swap CSS/JS;
moving screenshots to `src/assets` for `astro:assets`; the v0.3 blog post
markdown (or a blog-wide MDX img component); a repo check that new posts get
dimensions.

**Out of scope**: hero copy/layout (recently redesigned — plans 60/2472
territory); OG images; the dashboard app.

## Git workflow

- Branch: `advisor/90-landing-blog-image-optimization`
- Commits: `perf(landing): single themed screenshot element via image-set`,
  `perf(landing): astro:assets pipeline for screenshots`,
  `fix(blog): intrinsic dimensions + lazy loading for post images`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: One element per screenshot
Replace each light/dark `<img>` pair with a single `<picture>` whose sources
are selected by the theme: because the site supports a manual toggle (not just
`prefers-color-scheme`), the robust approach is one `<img>` whose `src` is
swapped by the existing theme-toggle script (data attribute → small JS), with
the initial value chosen server-side/inline to match the stored theme before
paint (read how `Base.astro` avoids theme flash today and hook the same
mechanism). Preserve `width`/`height`/`alt`.
**Verify**: build green; `rg -c 'data-shot="dark"' apps/landing/src/components` → 0; manual preview in both themes — correct screenshot, no flash, network tab shows ONE image per slot.

### Step 2: astro:assets for screenshots
Move the referenced PNGs from `public/landing-assets/` to
`src/assets/landing/`; render via `astro:assets` `<Picture formats={['avif','webp']} ...>`
(or `getImage` inside the theme-swap component from Step 1 — combine: generate
optimized variants for BOTH themes, still load one). Keep original PNGs out of
the final `public/` (delete after re-pointing; check nothing else references
the public paths: `rg -n "landing-assets/<name>" apps/landing apps/blog docs README.md`).
**Verify**: build output contains `.avif`/`.webp` variants; total transferred
bytes for the homepage screenshots drops (compare `ls -l` of emitted assets vs
the original PNG sizes; record numbers in the PR).

### Step 3: Blog image hygiene
Add `width`/`height` (read each PNG's real dimensions via `sips -g pixelWidth -g pixelHeight <file>`)
and `loading="lazy"` to the v0.3 post's `<img>` tags (all below the fold except
the first). If the blog has an MDX/markdown img component layer, prefer fixing
it there once.
**Verify**: blog build green; `rg -c 'loading="lazy"' apps/blog/src/content/blog/chmonitor-v0-3.md` ≈ image count.

## Done criteria

- [ ] One themed image element per screenshot slot (both themes visually verified)
- [ ] Screenshots served as AVIF/WebP with srcset via astro:assets
- [ ] v0.3 post images have dimensions + lazy loading
- [ ] Both builds green; byte savings recorded in PR; `plans/README.md` updated

## STOP conditions

- The theme toggle mechanism doesn't expose a pre-paint hook (flash unavoidable
  with a JS swap) — fall back to shipping both variants ONLY for
  above-the-fold slots and lazy-swapping below-fold; report the tradeoff.
- `verify-homepage-structure` type landing tests (there is a "homepage
  structure verify" script per recent commits) fail on the new markup — update
  the verify to match ONLY if its intent (structure present) is preserved.

## Maintenance notes

- New screenshots should land in `src/assets/landing/` and use the shared
  themed-image component; note this in the landing README or component docblock.
