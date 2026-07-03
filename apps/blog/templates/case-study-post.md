<!--
Case-study post template.
Copy to apps/blog/src/content/blog/<slug>.md and fill in. Keep draft: true
until the claim-verification checklist at the bottom is fully checked.

Case studies can be a real anonymized/de-identified scenario, or a realistic
worked example built for this post — either is fine, but say which. Never
present a hypothetical as a real customer story.
-->
---
title: "<Outcome-oriented title, e.g. 'Diagnosing a slow-query regression start to finish'>"
description: "<The problem, the tool, the outcome, in one sentence>"
date: YYYY-MM-DD
tag: Case study
---

<One paragraph: the situation, stated plainly. If this is a composite/worked
example rather than a real incident, say so here explicitly.>

## The problem

<What broke or degraded, and how it was first noticed.>

## Investigating

<Walk through the actual chmonitor workflow used — pages visited, AI agent
tools invoked, queries run. Screenshots or SQL are welcome. This is the part
that should be reproducible by a reader with their own cluster.>

## Root cause

<What it turned out to be.>

## Resolution

<What was changed, and how the reader would confirm it worked (a chart
returning to baseline, an advisor recommendation being applied, etc).>

## Takeaway

<One or two sentences: the generalizable lesson, and which chmonitor feature
to reach for next time.>

## Related

- Docs: [<relevant docs page>](https://docs.chmonitor.dev/<slug>)

<!--
CLAIM-VERIFICATION CHECKLIST (delete this comment before setting draft: false)

- [ ] State explicitly whether this is a real incident (anonymized) or a
      worked/composite example — never blur the two.
- [ ] Every chmonitor feature/page/AI-agent tool named is merged to `main`.
- [ ] Any "the advisor recommended X" claim matches actual tool behavior —
      e.g. the query/MV/TTL advisors recommend DDL, they do not auto-apply it.
      Do not describe a recommend-only tool as having made a change itself.
- [ ] SQL/metrics shown are either real output or clearly marked illustrative.
- [ ] The docs cross-link resolves and the docs page agrees with this post.
-->
