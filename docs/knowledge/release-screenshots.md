---
id: release-screenshots
title: Release screenshots — capture, pick, frame
type: reference
status: active
updated: 2026-10-18
tags:
  - release
  - screenshots
  - blog
  - marketing
related:
  - product-design
---

# Release screenshots

The durable reference behind the `release-screenshots` Claude skill
(`.claude/skills/release-screenshots/`). Release posts, the landing changelog,
and social posts use framed images, not raw full-screen captures.

## Format

- 1600x1000 CSS canvas rendered at DPR 2, exported as 2000x1250 WebP
  (about 130–180 KB).
- Backdrop: a real photo, see [Photo backdrop](#photo-backdrop).
- Three layouts: single window with a headline, single window plus one zoomed
  callout, and before/after split.
- The cover is dark, shows Overview, and carries the release headline and a
  version pill.

## Rules

1. **Privacy gate.** No hostnames, service DNS names, IPs, connection strings,
   real workload table or user names, emails, or keys. Watch DDL with
   `HOST '…'` or `SOURCE(POSTGRESQL(…))` and URLs in settings. Generic names
   such as `clickhouse-0` or `system.query_log` are fine. Re-capture or crop;
   never blur. (v0.3.6: Schema Compare and TTL captures were rejected for
   showing real service hosts and workload table names.)
2. **One idea per image.** The headline is 6 words or fewer and matches what
   the crop shows.
3. **Before/after uses the same page, viewport, theme, and crop** on both sides.
4. **Raw captures stay outside the repo** (next to the launch assets). Only
   rendered WebP files are committed, under `apps/blog/public/posts/vX.Y.Z/`.

## Spec format

One JSON array per release. Paths are relative to the spec file. Coordinates
are **source pixels** (a 3840x2160 capture is 2x the CSS layout).

| Field | Use |
|---|---|
| `name` | Output file name (`<name>.webp`) |
| `theme` | `light` (default) or `dark` |
| `eyebrow` | Short section label, shown uppercase in orange |
| `title` | Headline, 6 words or fewer |
| `sub` | One sentence, optional |
| `ver` | Version pill next to the logo, optional (cover only) |
| `src`, `crop` | Capture and `{x,y,w,h}` region for a single window |
| `callouts` | Optional `[{x,y,w,h, zoom, at:{x,y}, label}]`: ring the source region and show it magnified at canvas point `at` |
| `bg` | Photo backdrop (path relative to the spec). Default: `meadow-hill.jpg` from the backgrounds below; this is the house style |
| `bgPos` | CSS `background-position` for the photo (for example `50% 70%`), so a set of images does not repeat the same crop |
| `layout: "split"` + `panes` | Before/after: `[{label, src, crop}, …]`; `label` takes HTML, wrap the keyword in `<b>` |

Crop rules:

- Single window: crop aspect about **1.94:1** (for example 2400x1236) fills
  the window width. Let the window run off the bottom edge.
- Split pane: crop aspect about **1.21:1** (for example 1700x1400), the
  **same crop** on both panes.
- Callouts: one per image, on a control 2–4x smaller than the window. Place
  `at` over quiet content (empty space, a chart body), never over the
  headline.

## Photo backdrop

Release images use a real photo behind the app window (`bg`), not a generated
grid or glow. With `bg` set, the frame switches to the photo style: plain
sentence-case eyebrow, a dark headline over the sky, the version as plain text
next to the logo, the window resting on the meadow with a soft natural shadow,
and white callouts. Avoid the generic tells: grid backdrops, orange glows, mono
uppercase labels with rules, outlined pills, neon rings.

Backgrounds in `.claude/skills/release-screenshots/assets/backgrounds/` (from the maintainer's own image library,
downscaled to 2400px):

- `meadow-hill.jpg` — sky over a grassy hill with flowers. Default for every image.
- `meadow-lake.jpg` — painted meadow and lake. Busier at the edges; use sparingly.

The headline sits on the sky, so it needs a light, low-detail top third. A deep
saturated sky makes dark text unreadable — check contrast before adding a new
background. Without `bg`, the frame falls back to the older grid style.

## Review checklist

Look at every output at full size and check:

- [ ] Each image passes the privacy check, including inside callouts.
- [ ] Each file is distinct (`md5 -q *.webp | sort -u | wc -l` equals the shot
      count).
- [ ] The headline and the screenshot say the same thing.
- [ ] Callouts sit over quiet content and do not cover the thing they explain.
- [ ] Version strings keep their case (`v0.3.6`, not `V0.3.6`).

In the post, use `width="2000" height="1250"`, a descriptive `alt`, and set the
cover as the post's `cover:` frontmatter.

## Tooling

- `frame.html` lays out one spec. `render.mjs` loops the specs, captures with
  agent-browser, and converts with `cwebp`. Run it with `bun`: `node` may be a
  lazy-load shell function that `execFileSync` cannot call. Needs
  `agent-browser`, `cwebp`, and `sips` (macOS). Each run uses its own
  agent-browser session (`RELEASE_SHOTS_SESSION`), so releases can render in
  parallel.
- `.claude/skills/release-screenshots/examples/v0.3.6.json` is the spec for the v0.3.6 recap post.
- `frame.html` must not declare a global that shadows a `window` property
  (`top`, `name`, `status`): the script throws, nothing renders, and
  `render.mjs` waits until it times out.
- agent-browser does not reload on a hash-only URL change, so `render.mjs` adds
  `?shot=<name>` to every open.
