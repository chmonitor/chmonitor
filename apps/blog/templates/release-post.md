<!--
Release post template.
Copy to apps/blog/src/content/blog/<slug>.md and fill in. Keep draft: true
until the claim-verification checklist at the bottom is fully checked.

Usually you won't start from this file by hand — run:
  cd apps/blog && bun run scripts/release-to-post.mjs <tag>
which scaffolds this template pre-filled from a real GitHub release.
-->
---
title: "chmonitor vX.Y — <one-line theme>"
description: "<1-2 sentence summary of what shipped, written for a SERP snippet>"
date: YYYY-MM-DD
tag: Release
version: vX.Y
---

chmonitor **vX.Y** ships <N> new features and <N> fixes. <One paragraph on the
headline change — the thing a returning user would notice first.>

## What's new

<div class="hl-grid">
  <div class="hl"><b>&lt;Feature name&gt;</b><span>&lt;One sentence, plain language, no marketing adjectives.&gt;</span></div>
  <!-- repeat one .hl block per headline feature -->
</div>

## <Headline feature, expanded>

<2-4 paragraphs. Link the docs page that covers the feature in depth — this is
half of the docs<->blog cross-link convention (see apps/blog/README.md). Link
the GitHub issue/PR for anything a reader might want to verify further.>

See [<docs page title>](https://docs.chmonitor.dev/<slug>) for the full
reference.

## Upgrading

<What a self-hoster or Cloud user needs to do, if anything. Link the
migration doc if one exists under docs/content/reference/migrating/.>

## Full changelog

See the [GitHub release](https://github.com/chmonitor/chmonitor/releases/tag/vX.Y)
for the complete list of changes.

<!--
CLAIM-VERIFICATION CHECKLIST (delete this comment before setting draft: false)

For every feature/claim named above:
- [ ] The PR/commit that shipped it is merged to `main` (not just open, not a plan doc).
- [ ] The version tag in frontmatter matches the tag the feature actually shipped in.
- [ ] If the docs page linked above describes the feature differently, the docs page
      is correct — this post matches it, not the other way around.
- [ ] No roadmap/planned/future feature is described as shipped or "available now".
- [ ] Self-hosted vs Cloud scope is accurate (don't claim Cloud-only behaviour ships
      for self-hosted, or vice versa) — see CLAUDE.md "One codebase" section.
- [ ] Any env var / config flag named is spelled exactly as in
      docs/content/reference/environment-variables.mdx.
- [ ] The docs<->blog cross-link resolves both ways (this post links the docs page;
      the docs page links back to this post).
-->
