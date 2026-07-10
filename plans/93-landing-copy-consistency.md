# Plan 93: Landing copy consistency — pricing FAQ, spellings, CTA casing, integration claims

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/landing/src`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED only for the integration-claims part (needs a wiring check)
- **Depends on**: none
- **Category**: docs / landing UX
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2510

## Why this matters

Four copy inconsistencies on the money-adjacent marketing surface:

1. **FAQ contradicts the pricing page**: FAQ says "pricing is not yet
   finalised" while `/pricing` renders concrete tiers ($29 Pro / $99 Max from
   `@chm/pricing`) framed as "Early access is free to try while in beta".
2. **The honesty denylist is stale OR the hero over-claims**: 
   `data/use-cases.ts` (enforced by `use-cases.test.ts`) declares PagerDuty /
   Telegram / OpsGenie / email "roadmap-only … not wired to any UI today" —
   but the repo now contains adapters (`apps/dashboard/src/lib/health/adapters/pagerduty.ts`,
   `opsgenie.ts`), routes (`routes/api/v1/health/pagerduty-services.ts`), and UI
   (`components/health/alert-routing-dialog.tsx`) — while `Hero.astro:17`,
   `data/feature-showcase.ts:88`, `ProductHighlights.tsx:20` already advertise
   Opsgenie/PagerDuty. One of the two surfaces is wrong.
3. **British spellings** in otherwise-American copy: `FAQ.astro:25`
   "finalised", `Footer.astro:19` "memorising".
4. **CTA casing**: "Read the Docs" (`FinalCta.astro:40`) vs "Read the docs"
   (`OpenSource.astro:28`, `pages/404.astro:31`).

## Current state

Files: `apps/landing/src/components/FAQ.astro` (line ~25),
`Footer.astro` (~19), `FinalCta.astro` (~40), `OpenSource.astro` (~28),
`pages/404.astro` (~31), `data/use-cases.ts` (~lines 8-10 comment + data),
`use-cases.test.ts` (the denylist test), `Hero.astro` (~17),
`data/feature-showcase.ts` (~88), `ProductHighlights.tsx` (~20).
Pricing source of truth: `packages/pricing/src/plans.ts` (contains the
early-access/grandfathering strategy note — align FAQ wording with it).

**Caution — plans/README context**: the alerting cluster (Opsgenie #2248 etc.)
is mid-reconciliation; email transport (#2218) is explicitly a HELD no-op stub.
So "email alerts" must NOT be claimed shipped regardless.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Landing tests | `cd apps/landing && pnpm install && bun test` (check package.json for the runner) | pass |
| Landing build | `cd apps/landing && pnpm run build` | exit 0 |

## Scope

**In scope**: the copy files listed; `use-cases.ts` + its test (only per the
Step 2 verification outcome).

**Out of scope**: pricing numbers (source of truth is `@chm/pricing` — don't
touch); hero layout; shipping any alerting feature.

## Git workflow

- Branch: `advisor/93-landing-copy-consistency`
- Commit: `fix(landing): align FAQ with pricing page, unify spelling and CTA casing`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Mechanical copy fixes
"finalised" → "finalized"; "memorising" → "memorizing"; unify the CTA to
"Read the docs" (sentence case — the majority form) in `FinalCta.astro`.
Rewrite the FAQ pricing answer to match reality, e.g.: "Early-access pricing is
listed on the pricing page ($29 Pro / $99 Max). Prices may change before GA;
early-access accounts will be grandfathered." (Confirm the grandfathering
claim against the strategy note in `packages/pricing/src/plans.ts` — if it
isn't stated there, omit the grandfathering sentence.)
**Verify**: `rg -n "finalised|memorising|Read the Docs" apps/landing/src` → no matches; build green.

### Step 2: Verify integration wiring, then fix WHICHEVER surface is wrong
Check end-to-end reachability for PagerDuty and Opsgenie: is
`alert-routing-dialog.tsx` reachable from a shipped page, and does the dispatch
path exist on main (not only in the conflicting PRs)? Concretely: `git log
--oneline -5 -- apps/dashboard/src/lib/health/adapters/pagerduty.ts` and check
whether `server-sweep.ts` on main dispatches to those adapters.
- If REACHABLE on main: update `use-cases.ts`'s denylist comment + test to
  remove PagerDuty/Opsgenie (email + Telegram + DDL auto-apply stay
  roadmap-only), and let the use-case pages mention them.
- If NOT reachable: remove Opsgenie/PagerDuty claims from `Hero.astro`,
  `feature-showcase.ts`, `ProductHighlights.tsx` until the alerting cluster
  lands.
**Verify**: `bun test` in apps/landing passes (the denylist test enforces
whichever direction you took); record the wiring evidence in the PR description.

## Done criteria

- [ ] FAQ consistent with the pricing page
- [ ] No British spellings; single CTA casing
- [ ] Hero claims and use-case denylist agree with main's actual capability
- [ ] Landing tests + build green; `plans/README.md` updated

## STOP conditions

- Wiring status is genuinely ambiguous (adapters exist, dispatch merged, but
  UI flag-gated) — report the exact gating rather than picking a side.

## Maintenance notes

- The `use-cases.test.ts` denylist is the honesty mechanism — future feature
  merges should update it in the same PR (the alerting-cluster reconciler
  should be told when 26/28-33 land).
