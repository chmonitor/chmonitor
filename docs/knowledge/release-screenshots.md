---
id: release-screenshots
title: Release screenshots — capture, pick, frame
type: reference
status: active
updated: 2026-10-03
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
- Backdrop: a real photo (`assets/backgrounds/meadow-hill.jpg`), not a
  generated grid or glow. Dark headline on the sky, window resting on the
  meadow, white callouts, Geist type. Vary `bgPos` across a set.
- Three layouts: single window with a headline, single window plus one zoomed
  callout, and before/after split.
- The cover is dark, shows Overview, and carries the release headline and a
  version pill.

## Rules

1. **Privacy gate.** No hostnames, service DNS names, IPs, connection strings,
   real workload table or user names, emails, or keys. Re-capture or crop;
   never blur. (v0.3.6: Schema Compare and TTL captures were rejected for
   showing real service hosts and workload table names.)
2. **One idea per image.** The headline is 6 words or fewer and matches what
   the crop shows.
3. **Before/after uses the same page, viewport, theme, and crop** on both sides.
4. **Raw captures stay outside the repo** (next to the launch assets). Only
   rendered WebP files are committed, under `apps/blog/public/posts/vX.Y.Z/`.

## Tooling

- `frame.html` lays out one spec. `render.mjs` loops the specs, captures with
  agent-browser, and converts with `cwebp`. Run it with `bun`.
- `examples/v0.3.6.json` is the spec for the v0.3.6 recap post.
- Known traps: a global `const top` in `frame.html` silently breaks rendering;
  a hash-only URL change does not reload the page in agent-browser.
