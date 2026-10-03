---
name: release-screenshots
description: >-
  Capture, pick, and design the screenshots for a chmonitor release: blog
  release posts, the landing changelog, What's new, and social posts. Covers
  capturing the dashboard at 2x, the privacy check every image must pass,
  choosing one idea per image, cropping, and rendering branded frames
  (headline, before/after split, zoomed callouts) to WebP with the bundled
  frame.html + render.mjs. Triggers: "release images", "release screenshots",
  "blog post images", "screenshot for the changelog", "social image",
  "cover image", "before and after", "make the screenshots look professional",
  "crop and decorate", "redesign the screenshots".
---

# Release screenshots

A release image has one job: show **one change** so a reader gets it in two
seconds. Raw full-screen captures fail that job — the change is a small part
of a busy page. This skill turns captures into framed images: a short
headline, the screenshot cropped to the part that matters, and at most one
zoomed callout. Backing doc: `docs/knowledge/release-screenshots.md`.

## 1. Capture

- Capture the **real product**, never a mockup. Use agent-browser at
  1920x1080 with DPR 2 (3840x2160 PNG), light theme by default, plus a dark
  capture of Overview for the cover:

  ```sh
  agent-browser set viewport 1920 1080 2
  agent-browser open "<dashboard>/overview?host=0"
  agent-browser wait --load networkidle
  agent-browser screenshot capture/raw/new-overview.png
  ```

- For before/after, capture both versions on the **same page, same viewport,
  same theme**, so only the change differs.
- Close toasts, popovers, and dev overlays first — unless the popover *is* the
  feature (for example the More flyout).
- Keep captures next to the release's other launch assets (for example
  `launch/vX.Y.Z/capture/raw/`), outside the repo. Only finished images go in
  the repo.

## 2. Privacy check (hard gate)

Open every capture at full size and reject it if it shows any of:

- Hostnames, service DNS names, IPs, or connection strings (DDL with
  `HOST '…'`, `SOURCE(POSTGRESQL(…))`, URLs in settings).
- Real database, table, user, or customer names from a production workload.
- Emails, API keys, tokens, or real people's names.

Generic names are fine (`clickhouse-0`, `system.query_log`, `Guest`). If a
capture fails, re-capture against the demo host or crop the region out — do
not blur. Blurred text still reads as "we hid something". For example, the
v0.3.6 Schema Compare and TTL captures showed real Postgres service hosts and
workload table names, so they were left out.

## 3. Pick

- One idea per image. If you cannot write its headline in 6 words, it is two
  images or none.
- 4–6 images per post. Lead with the change a returning user notices first.
- Prefer a before/after split when the release changes something users already
  know. Prefer a single window with a callout for new features.
- The cover is dark, shows the main screen, and carries the release headline.

## 4. Write the spec

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
| `layout: "split"` + `panes` | Before/after: `[{label, src, crop}, …]`; `label` takes HTML, wrap the keyword in `<b>` |

Crop rules:

- Single window: crop aspect about **1.94:1** (for example 2400x1236) fills
  the window width. Let the window run off the bottom edge.
- Split pane: crop aspect about **1.21:1** (for example 1700x1400), the
  **same crop** on both panes.
- Callouts: one per image, on a control 2–4x smaller than the window. Place
  `at` over quiet content (empty space, a chart body), never over the
  headline.

`examples/v0.3.6.json` is a complete spec for a real release.

## 5. Render

```sh
bun .claude/skills/release-screenshots/render.mjs <spec.json> apps/blog/public/posts/vX.Y.Z
```

Each image comes out 2000x1250 WebP at 60–100 KB. Run it with `bun`: `node` may
be a lazy-load shell function on dev machines, which `execFileSync` cannot
call. Needs `agent-browser`, `cwebp`, and `sips` (macOS).

## 6. Review before shipping

Look at every output at full size and check:

- [ ] Each image passes the privacy check, including inside callouts.
- [ ] Each file is distinct (`md5 -q *.webp | sort -u | wc -l` equals the shot
      count).
- [ ] The headline and the screenshot say the same thing.
- [ ] Callouts sit over quiet content and do not cover the thing they explain.
- [ ] Version strings keep their case (`v0.3.6`, not `V0.3.6`).

In the post, use `width="2000" height="1250"`, a descriptive `alt`, and set the
cover as the post's `cover:` frontmatter.

## Gotchas

- `frame.html` must not declare a global named `top`, `name`, `status`, or
  similar `window` properties: in a classic script `const top` throws, nothing
  renders, and `render.mjs` waits until it times out.
- agent-browser does not reload when only the URL hash changes. `render.mjs`
  adds `?shot=<name>` to every open so each shot gets a fresh page.
