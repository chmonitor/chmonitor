# Plan 91: Fix README's broken docs links + docs naming/staleness cleanup

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- README.md docs/content/guide/guides/connection-errors.mdx`

## Status

- **Priority**: P1 (repo front door)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2508

## Why this matters

Eleven `docs.chmonitor.dev` links in the README omit the top-level route
segment the live Fumadocs site uses (`/guide`, `/operate`, `/reference`), so
every "Getting Started" and "Deployments" link plus both "Migrate to v0.3"
callouts 404 for new users. Bundled: one docs page uses the old product name,
and the README carries a stale uptime-badge slug + a legacy Vercel emphasis.

## Current state

Broken links in `README.md` (verified against the tree
`docs/content/guide/getting-started/*.mdx`, `docs/content/operate/deploy/*.mdx`,
`docs/content/reference/migrating/v0-3.mdx`):

| Line | Current | Correct |
|------|---------|---------|
| 30, 216 | `/migrating/v0-3` | `/reference/migrating/v0-3` |
| 83, 265 | `/deploy/k8s` | `/operate/deploy/k8s` |
| 258 | `/getting-started` | `/guide/getting-started` |
| 259 | `/getting-started/local` | `/guide/getting-started/local` |
| 260 | `/getting-started/clickhouse-requirements` | `/guide/getting-started/clickhouse-requirements` |
| 261 | `/getting-started/clickhouse-enable-system-tables` | `/guide/getting-started/clickhouse-enable-system-tables` |
| 262 | `/deploy` | `/operate/deploy` |
| 263 | `/deploy/vercel` | `/operate/deploy/vercel` |
| 264 | `/deploy/docker` | `/operate/deploy/docker` |
| 267 | `/advanced` | `/operate/advanced` (CONFIRM this page exists — see Step 1) |

Line 270 `/reference` is already correct.

Also:
- `docs/content/guide/guides/connection-errors.mdx` lines 3, 23, 120, 128 —
  "ClickHouse Monitor" → "chmonitor" (only doc with the old name).
- `README.md:5-6` — uptime badge still uses the pre-rebrand
  `clickhouse-monitoring-vercel-app` slug (self-noted in an HTML comment).
- `README.md:263` — Vercel listed as a first-class deploy target but
  `docs/content/operate/deploy/vercel.mdx` is a legacy v0.2-only guide; mark it
  "(legacy v0.2)" in the README list.
- `README.md:254` — the `[/docs](/docs)` link is ambiguous (GitHub folder vs
  docs site); label it explicitly.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Link check | `for u in <corrected urls>; do curl -s -o /dev/null -w "%{http_code} $u\n" "$u"; done` | all 200 |
| Docs build (optional) | `cd apps/docs && pnpm install && pnpm run build` | exit 0 |

## Scope

**In scope**: `README.md`, `docs/content/guide/guides/connection-errors.mdx`.

**Out of scope**: restructuring README sections (issue #2472 / plans 60+
own the landing/README shape); other docs pages; the uptime badge *provider*
(just fix the slug if a working one exists — see STOP).

## Git workflow

- Branch: `advisor/91-readme-docs-link-fixes`
- Commit: `docs(readme): fix docs.chmonitor.dev link prefixes and naming drift`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Confirm each corrected URL resolves
Curl each corrected URL (table above) against the live site; for `/advanced`
find the real slug first (`ls docs/content/operate/` — if there is no
`advanced` page, find where its content lives via
`rg -ril "advanced" docs/content --files-with-matches | head` and link there,
or drop the line).
**Verify**: every URL in the final table returns 200.

### Step 2: Apply README edits
All rows in the table + the Vercel "(legacy v0.2)" annotation + the `/docs`
link label. Fix the badge slug only if the correct current status-page slug is
discoverable (check the HTML comment near lines 5-6); otherwise remove the dead
badge and note why in the commit.
**Verify**: `rg -n "docs.chmonitor.dev" README.md` — every URL matches the corrected table; curl-sweep all of them → 200.

### Step 3: Rename in connection-errors.mdx
Replace the 4 occurrences of "ClickHouse Monitor" with "chmonitor".
**Verify**: `rg -n "ClickHouse Monitor" docs/content/guide/guides/connection-errors.mdx` → no matches.

## Done criteria

- [ ] Curl sweep: all README docs links 200
- [ ] No "ClickHouse Monitor" naming in connection-errors.mdx
- [ ] Vercel marked legacy; badge fixed or removed
- [ ] `plans/README.md` updated

## STOP conditions

- The live docs site 404s even on corrected paths (site-side routing issue) —
  report; don't guess new paths.

## Maintenance notes

- Consider (deferred, noted for the maintainer): a link-check CI step over
  README.md + docs cross-links — this class of drift will recur with every
  docs reorganization.
