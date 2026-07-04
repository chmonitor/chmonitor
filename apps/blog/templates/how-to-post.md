<!--
How-to post template.
Copy to apps/blog/src/content/blog/<slug>.md and fill in. Keep draft: true
until the claim-verification checklist at the bottom is fully checked.
-->
---
title: "<Verb-first task, e.g. 'Alerting to Slack, Discord, Telegram, and PagerDuty'>"
description: "<What the reader will be able to do after reading, in one sentence>"
date: YYYY-MM-DD
tag: How-to
---

<One paragraph: who this is for and what they'll have working by the end.>

## Prerequisites

- <e.g. a chmonitor instance already connected to a cluster>
- <e.g. permission to set Cloudflare Worker secrets / env vars>

## Steps

### 1. <First concrete step>

<Instructions. Prefer copy-pastable commands over prose.>

```bash
<command>
```

### 2. <Next step>

...

## Verifying it worked

<How the reader confirms success — a curl command, a UI element that appears,
a log line. Never end a how-to without a way to check the result.>

## Related

- Docs: [<canonical docs page for this feature>](https://docs.chmonitor.dev/<slug>)
  — this post is the narrative walkthrough; the docs page is the reference.

<!--
CLAIM-VERIFICATION CHECKLIST (delete this comment before setting draft: false)

- [ ] Every command/flag/env var was run/checked against the current codebase,
      not remembered from an older version.
- [ ] The feature described is merged to `main` (not a plan doc, not an open PR).
- [ ] Self-hosted vs Cloud scope is accurate for each step (see CLAUDE.md
      "One codebase" section) — call out explicitly if a step is Cloud-only.
- [ ] The docs cross-link resolves, and the linked docs page agrees with this
      post (if they conflict, fix the post to match the docs, not vice versa).
- [ ] Add a reverse link from the docs page back to this post (docs<->blog
      cross-linking is bidirectional by convention).
- [ ] No feature named here is described as available on a platform it doesn't
      ship on (e.g. don't claim a Cloud-only per-user feature works self-hosted).
-->
