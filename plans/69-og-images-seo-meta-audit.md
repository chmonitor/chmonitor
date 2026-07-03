# 69 — OG images + SEO meta/schema audit

## Goal
Generate per-page Open Graph images at build time and audit/complete per-page title/description + JSON-LD schema across landing (and blog), so every page is share-ready and rich-result eligible.

## Current reality (audited)
OG images and per-page meta are not page-specific, so social shares and SERP snippets are generic. The landing centralizes `<head>` in `Base.astro` but does not generate per-page OG images or per-page schema. Pointers (verify at head):
- Head/meta owner: `apps/landing/src/layouts/Base.astro` — extend to accept per-page `title`/`description`/`ogImage`/`schema`.
- OG generation: the docs app already uses an image pipeline (takumi/resvg per the roadmap) — reuse that toolchain. New script `apps/landing/src/scripts/generate-og.mjs` (verify — create the scripts/ dir).
- Pages needing meta/OG: `src/pages/index.astro`, `pricing.astro`, `changelog.astro`, `brand.astro`.
- Blog: `apps/blog/` posts should get per-post OG + meta on the same convention (verify blog head owner).

## Implement now (depth F — file-level)
### A. Per-page OG generation — `apps/landing/src/scripts/generate-og.mjs` (new)
- Reuse the docs' takumi/resvg-based renderer to produce a branded OG image per page at build time (title + consistent chmonitor template). Output to a static assets dir the pages reference. Constrain: <100KB per image, legible, consistent template. Wire into the landing build (Astro integration hook or prebuild step); cache/skip unchanged pages if practical.
### B. Meta fields — `layouts/Base.astro` + per page
- Extend `Base.astro` to require/accept `title` (50–60 chars) and `description` (150–160 chars), and emit `<title>`, `<meta name=description>`, Open Graph (`og:title/description/image/url/type`), Twitter card (`summary_large_image`, title/description/image). Give each page a unique, honest title + description. Grep-confirm no two pages share a title/description.
### C. Schema (JSON-LD) — per page type
- `SoftwareApplication` (+ `Offer` reflecting the real pricing tiers) on home/product pages. `FAQPage` on any page with a real FAQ (`FAQ.astro`) — Q&A text must match what the product actually does. `BreadcrumbList` on sub-pages. Emit via a small helper in `Base.astro`.
### D. Validation pass
- Run built pages through OG/meta length checks + a structured-data validator; fix warnings. Confirm images <100KB and readable.

## STOP conditions & drift check
- STOP if per-page OG generation already exists — reuse/extend; don't add a second pipeline.
- STOP and correct any schema/description claiming a non-shipped capability.
- DRIFT: if `Base.astro` is bypassed by any page hand-rolling `<head>`, route it back through `Base.astro`.
- Keep OG images <100KB; no runtime image generation.

## Done criteria
- Unique, <100KB, readable OG image per landing (and blog) page, wired via `og:image`.
- Unique, length-correct title + description per page; full OG + Twitter tags via `Base.astro`.
- Valid `SoftwareApplication`/`Offer`, `FAQPage`, `BreadcrumbList` schema; every claim maps to a shipped feature.
- `apps/landing` (and blog) `bun run build` green.
