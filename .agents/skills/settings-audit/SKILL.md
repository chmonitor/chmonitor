---
name: settings-audit
description: "Read-only audit of ClickHouse settings: lists changed settings in system.settings, system.merge_tree_settings and system.server_settings, flags Experimental, Beta and Obsolete ones in use, explains each from its description, and recommends (never applies) changes. Load for audit settings, experimental settings in use, obsolete settings, or config review."
---

# Settings Audit

Find settings that differ from the defaults and are risky: `Experimental`,
`Beta`, or `Obsolete`. Explain each one and recommend. **Read-only: never run
`SET`, `ALTER`, or edit config. Recommend only.**

## Step 0 - Discover columns (version-safe)

`tier` exists only on newer versions and is not on every table (for example,
`system.server_settings` has `is_obsolete` but no `tier` on 26.5). Never assume
a column. Run this first:

```sql
SELECT table, groupArray(name) AS cols
FROM system.columns
WHERE database = 'system'
  AND table IN ('settings', 'merge_tree_settings', 'server_settings')
  AND name IN ('tier', 'is_obsolete', 'changed', 'description')
GROUP BY table
ORDER BY table
```

- Table missing from the result: skip it and say so.
- `changed` missing: the table cannot be filtered to changes; skip it.
- `tier` present: use the "with tier" query. Otherwise use the "without tier"
  query and flag only `is_obsolete`. If `is_obsolete` is also missing, drop it
  and list all changed settings for manual review.

## Step 1 - system.settings

With `tier`:

```sql
SELECT name, value, default, tier, description
FROM system.settings
WHERE changed AND tier IN ('Experimental', 'Beta', 'Obsolete')
ORDER BY multiIf(tier = 'Experimental', 1, tier = 'Beta', 2, 3), name
```

Without `tier`:

```sql
SELECT name, value, default, is_obsolete, description
FROM system.settings
WHERE changed AND is_obsolete
ORDER BY name
```

Also list all changed settings (any tier) so the user sees the full drift:

```sql
SELECT name, value, default, description
FROM system.settings
WHERE changed
ORDER BY name
```

`system.settings` shows what this connection's user and profile see, not every
profile on the server.

## Step 2 - merge tree and server settings

Same pattern, only where the columns exist (Step 0).

```sql
SELECT name, value, default, tier, description
FROM system.merge_tree_settings
WHERE changed AND tier IN ('Experimental', 'Beta', 'Obsolete')
ORDER BY multiIf(tier = 'Experimental', 1, tier = 'Beta', 2, 3), name
```

Without `tier`:

```sql
SELECT name, value, default, is_obsolete, description
FROM system.merge_tree_settings
WHERE changed AND is_obsolete
ORDER BY name
```

`system.server_settings` has no `tier` on tested versions, so flag
`is_obsolete`. If Step 0 shows `tier` there, reuse the tier query.

```sql
SELECT name, value, default, changeable_without_restart, is_obsolete, description
FROM system.server_settings
WHERE changed
ORDER BY is_obsolete DESC, name
```

`changeable_without_restart` is missing on older versions; drop it there.

## Step 3 - Explain each flagged setting

For every flagged row, explain in one or two sentences from its `description`
column. If a tool named explain_clickhouse_symbol exists in your tool list, call
it for the setting name instead of paraphrasing. If a description is empty,
say it is undocumented; do not guess.

## Step 4 - Recommend, never change

Report a table: setting, scope (query / merge tree / server), value vs default,
tier, why it matters, recommendation.

- **Experimental**: may change or be removed without notice and can lose or
  corrupt data. Recommend removing from production profiles unless the user
  accepts the risk.
- **Beta**: works but is not yet Production; recommend testing before relying
  on it.
- **Obsolete**: ignored or no effect; recommend deleting it from profiles and
  config so it does not hide a real change.
- A changed `Production` setting is not a finding. List it under "other
  changes" only.

End with the exact statements the user could run themselves (for example
`ALTER USER ... SETTINGS ...` or a config edit), labeled as suggestions you did
not execute. If nothing is flagged, say the audit found no Experimental, Beta
or Obsolete settings in use.
