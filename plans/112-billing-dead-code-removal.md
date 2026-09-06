# Plan 112: Delete the orphaned billing UI/paywall leftovers (dead code)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/src/lib/billing/ apps/dashboard/src/lib/api/error-handler/`
> On mismatch, re-read live files.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3307

## Why this matters

The billing removal (STATUS.md, `feat/dashboard-no-billing` direction) left a
cluster of dead modules that still LOOK load-bearing: an orphaned paywall store
whose modal components no longer exist, a billing-hook file whose four API
routes were deleted (any future import silently hits 404s), a retry helper with
one dead consumer, and a contact module with zero importers. Stale comments in
three places actively claim wiring that doesn't exist. Deleting them shrinks
the OSS bundle's apparent live surface and stops misleading maintainers.

## Current state (all verified zero-importer during the audit)

- `apps/dashboard/src/lib/billing/paywall-store.ts:39` — `showPaywall()` has
  zero callers; named components (`paywall-modal.tsx`, `paywall-host.tsx`) are
  gone. Header comment claims `apiFetch` classifies 402s — it does not.
- `apps/dashboard/src/lib/api/error-handler/error-classifier.ts:218` —
  `classifyBillingLimit` exported via `error-handler/index.ts:36`, imported by
  nothing.
- `apps/dashboard/src/lib/billing/use-billing.ts:70,105,127,150` — calls
  `/api/v1/billing/{subscription,checkout,portal,can-downgrade}`; only
  `routes/api/v1/billing/usage.ts` survives.
- `apps/dashboard/src/lib/billing/retry.ts` — sole consumer is use-billing.ts;
  has `__tests__/retry.test.ts`.
- `apps/dashboard/src/lib/billing/contact.ts:8–16` — zero importers.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `pnpm run type-check` | exit 0 |
| Unit tests | `pnpm run test:unit` | pass |
| Dead-symbol proof | `rg -n "showPaywall\|classifyBillingLimit\|useBillingSubscription\|salesContactMailto" apps/dashboard/src --glob '!**/billing/**' --glob '!**/error-classifier.ts'` | no matches |

## Scope

**In scope**:
- Delete: `lib/billing/paywall-store.ts`, `lib/billing/use-billing.ts`,
  `lib/billing/retry.ts`, `lib/billing/__tests__/retry.test.ts`,
  `lib/billing/contact.ts`
- Edit: `lib/api/error-handler/error-classifier.ts` (remove
  `classifyBillingLimit` + its classification types), 
  `lib/api/error-handler/index.ts` (remove export)
- Comment fixes at: `hooks/use-favorites.ts:3`,
  `lib/menu/favorites-store.ts:10`, `analytics/analytics.ts:45–49`

**Out of scope**:
- `routes/api/v1/webhooks/polar.ts` adapter (plan 103 cutover — operator-driven)
- `lib/billing/polar-config.ts`, `entitlements.ts`, `plan-enforcement.ts`,
  `owner-usage.ts`, `guest-ai*` — all LIVE (webhook + fail-open resolution)
- Any route under `src/routes/`

## Git workflow

- Branch: `advisor/112-billing-dead-code`
- Commit: `refactor(billing): remove dead paywall/billing-client leftovers`

## Steps

1. Re-run the drift-check greps yourself; if ANY symbol above now has an importer outside its own file, STOP and report which.
2. Delete the five files listed. Remove `retry.test.ts`.
3. Excise `classifyBillingLimit` and its exclusive types from error-classifier;
   drop the index export. If shared types are used by remaining classifiers,
   keep those types.
4. Fix the three stale comments to describe current behavior (no paywall; 402s
   from server surface as plain errors).
5. Run the full command battery.

## Test plan

No new tests (deletion). All existing suites must pass unchanged.

## Done criteria

- [ ] All five files gone from `git status`/disk
- [ ] Dead-symbol grep returns no matches
- [ ] type-check + test:unit green
- [ ] No out-of-scope files touched

## STOP conditions

- Any symbol gains an importer between plan-writing and execution → STOP with the importer path.
- Type-check reveals hidden coupling (e.g., types imported elsewhere) → restore the minimal type exports if trivial, else STOP.

## Maintenance notes

- Plan 103's cutover checklist eventually deletes `webhooks/polar.ts` +
  `polar-webhooks.ts` too — keep this PR separate from that work.
- Reviewers: verify nothing in landing/docs references these symbols.
