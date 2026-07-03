<!--
Troubleshooting post template.
Copy to apps/blog/src/content/blog/<slug>.md and fill in. Keep draft: true
until the claim-verification checklist at the bottom is fully checked.
-->
---
title: "<Symptom as a question, e.g. 'Why is my ClickHouse replication lagging?'>"
description: "<What's causing it and how to fix it, in one sentence>"
date: YYYY-MM-DD
tag: Troubleshooting
---

<One paragraph: the symptom, when a reader would see it, why it matters.>

## Symptoms

- <What the reader observes — an error, a metric, a UI state>
- <Where they'd see it in chmonitor: page name / chart / system table>

## Common causes

### <Cause 1>

<Explanation. Include the `system.*` query a reader can run themselves to
confirm this is their cause.>

```sql
<diagnostic query>
```

### <Cause 2>

...

## Fix

<Concrete remediation steps, ordered by how likely they are to be the actual
cause. Distinguish "safe to run yourself" from "requires ClickHouse-side
config change" from "chmonitor can only surface this, not fix it".>

## How chmonitor surfaces this

<Which page/chart/AI-agent tool in chmonitor shows this, so the reader knows
where to look next time. Link the docs page.>

## Related

- Docs: [<relevant docs page>](https://docs.chmonitor.dev/<slug>)

<!--
CLAIM-VERIFICATION CHECKLIST (delete this comment before setting draft: false)

- [ ] Every diagnostic SQL query was actually run against a real ClickHouse
      instance and returns the columns/shape shown.
- [ ] The `system.*` tables referenced exist in the ClickHouse versions this
      applies to (check docs/clickhouse-schemas/tables/*.md if version-specific).
- [ ] The chmonitor feature/page cited as surfacing this is merged to `main`.
- [ ] The docs cross-link resolves and the docs page agrees with this post.
- [ ] Fix steps are marked correctly as chmonitor-side vs ClickHouse-side —
      don't imply chmonitor auto-fixes something it only recommends.
-->
