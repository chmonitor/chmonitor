---
name: release-screenshots
description: >-
  Capture, privacy-check, pick, crop, and frame chmonitor release images for
  blog release posts, the changelog, What's new, and social posts, rendered to
  WebP with the bundled frame.html and render.mjs. Use for release
  screenshots, cover images, before/after images, or redesigning existing ones.
---

# Release screenshots

A release image shows one change so a reader gets it in two seconds: a short
headline, the screenshot cropped to what matters, and at most one zoomed
callout. The spec format, crop rules, backdrop style, and review checklist are
in [docs/knowledge/release-screenshots.md](../../../docs/knowledge/release-screenshots.md).

## Steps

1. **Capture** the real product with agent-browser at 1920x1080, DPR 2, light
   theme, plus a dark Overview for the cover. Before/after pairs use the same
   page, viewport, and theme. Close toasts and overlays unless they are the
   feature. Keep raw captures outside the repo, next to the launch assets.

   ```sh
   agent-browser set viewport 1920 1080 2
   agent-browser open "<dashboard>/overview?host=0"
   agent-browser wait --load networkidle
   agent-browser screenshot capture/raw/new-overview.png
   ```

2. **Privacy gate.** Reject any capture that shows a hostname, IP, connection
   string, real workload database/table/user name, email, key, or person's
   name. Re-capture against the demo host or crop it out. Never blur.
3. **Pick** 4 to 6 images, one idea each, headline of 6 words or fewer. Use a
   before/after split for a change to something users know, one window with a
   callout for a new feature.
4. **Write the spec**, one JSON array per release.
   [`examples/v0.3.6.json`](examples/v0.3.6.json) is a complete one.
5. **Render** with `bun` (not `node`):

   ```sh
   bun .claude/skills/release-screenshots/render.mjs <spec.json> apps/blog/public/posts/vX.Y.Z
   ```

6. **Review** every output at full size against the checklist in the doc,
   then reference each image with `width="2000" height="1250"` and an `alt`.
