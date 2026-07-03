# 18 — Per-host overage billing

## Kickoff prompt

```text
Execute plans/18-per-host-overage-billing.md ALONE (do not touch other plans).
Goal: implement the advertised $15–19/host overage. Paid tiers SOFT-CAP hosts
(add a 4th+ host without a 402) and meter each over-limit host into a monthly bill;
Free stays HARD-CAPPED. Mirror the AI-overage model (plan 14).
Invariants you must not violate:
  - Self-hosted/OSS stays whole: host gating FAILS OPEN without Clerk. No Clerk →
    unlimited hosts, no metering. Verify the fail-open path stays intact.
  - Honest paywalls: advertised ⟺ enforced (or `deferred`) in lib/billing/plan-enforcement.ts.
    Only advertise host-overage as enforced once the meter + Polar reporting are wired;
    until Polar usage reporting is confirmed, mark it `deferred` with a reason — do NOT
    claim revenue you can't bill.
  - AI recommends DDL, never auto-applies (untouched).
  - Postgres/multi-DB: NO for 2026 H2 — new table is D1 only.
Polar usage-based reporting is the one uncertain integration: if the SDK/product
setup isn't confirmed, land the local meter (D1 host_usage_monthly) + soft-cap and
mark the Polar push as a follow-up. End by running Verification and pasting results.
```

## Current reality (audited)

The advertised $15–19/host overage (the GA land-and-expand lever) has **no code path** — paid hosts hard-cap instead of expanding.

- Host gate: `apps/dashboard/src/routes/api/v1/user-connections.ts` calls `checkHostLimit(plan, currentHosts)` (`entitlements.ts:81`) and 402s at the cap for **all** tiers. Host counting is pooled via org-host-count.
- Host pooling: `apps/dashboard/src/lib/billing/org-host-count.ts` (+ `org-host-count.test.ts`) — `countOwnerHosts`-style pooled count.
- Plan type: `packages/pricing/src/plans.ts` has `hosts: number|null` (`plans.ts:57`, "the BINDING meter") and an **AI** overage (`aiOverage: { usdPer; messages } | null`, `:73`) but **no `hostOverage` field**. Free `hosts: 1`; Pro `hosts: 3`; there is no per-host price field yet.
- The AI-overage model to mirror: `apps/dashboard/src/lib/billing/ai-usage-store.ts` (`ai_usage_monthly` table, `addAiSpend`) — plan 14 formalizes `meterAiOverage`.
- Enforcement registry: `apps/dashboard/src/lib/billing/plan-enforcement.ts` (`LIMIT_ENFORCEMENT`) currently marks `hosts` enforced (hard cap). This plan changes host semantics for paid tiers, so the registry entry must be updated honestly.

## Goal

Paid tiers soft-cap hosts: adding a host beyond the included count succeeds (no 402) and records an over-limit host-month that meters into the monthly bill at the plan's per-host price; the monthly total resolves as `base + (overage hosts × per-host price)`. Free stays hard-capped. OSS is unlimited and never metered.

## Implement now

### A. Add the pricing field — `packages/pricing/src/plans.ts`
- Extend the `Plan` type with:
  ```ts
  hostOverage: { usdPer: number } | null   // null = hard-cap (no expansion)
  ```
- Set Free `hostOverage: null` (hard cap at 1). Set Pro/Max `hostOverage: { usdPer: <15..19> }` per the advertised range (confirm the exact number against `apps/landing/src/data/pricing.ts` so the landing claim and code match — honest-paywall invariant).
- Update `packages/pricing` tests (`plans.test.ts`) for the new field's presence per tier.

### B. Soft-cap the gate — `apps/dashboard/src/lib/billing/entitlements.ts`
- Add `checkHostSoftCap(plan, currentHosts): { allowed: boolean; overageHosts: number }`:
  - if `currentHosts < plan.hosts` → `{ allowed: true, overageHosts: 0 }`.
  - else if `plan.hostOverage != null` → `{ allowed: true, overageHosts: currentHosts - plan.hosts + 1 }` (paid soft-cap; the new host is billable overage).
  - else → `{ allowed: false, overageHosts: 0 }` (Free hard cap; caller 402s).
- Keep `checkHostLimit` for callers that still want the hard boundary; this is additive.

### C. New meter store — `apps/dashboard/src/lib/billing/host-usage-store.ts` (new) + D1 migration
- D1 table `host_usage_monthly`:
  ```sql
  CREATE TABLE IF NOT EXISTS host_usage_monthly (
    owner_id   TEXT NOT NULL,
    month      TEXT NOT NULL,      -- 'YYYY-MM'
    host_count INTEGER NOT NULL,   -- peak billable overage hosts this month
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, month)
  );
  ```
- Exports (mirror `ai-usage-store.ts`):
  - `recordHostOverage(ownerId: string, overageHosts: number): Promise<void>` — upsert the **peak** billable overage count for the month (`host_count = MAX(existing, overageHosts)`), so removing/re-adding within a month doesn't multiply the charge.
  - `getHostOverageThisMonth(ownerId: string): Promise<number>`.
- Add the migration to the app's D1 migrations dir (same location as the `ai_usage_monthly`/subscription migrations).

### D. Wire the connection route — `apps/dashboard/src/routes/api/v1/user-connections.ts`
- Replace the hard `checkHostLimit` gate on host-add with `checkHostSoftCap(plan, currentHosts)`:
  - if `!allowed` → 402 (Free) with `reason: 'host'` (feeds the plan-15 paywall).
  - if `allowed && overageHosts > 0` → allow the add **and** `await recordHostOverage(owner.id, overageHosts)`.
- Preserve the fail-open path: if plan/owner resolution throws (no Clerk), allow the add and do not meter (OSS unlimited).

### E. Fold into the monthly bill — `apps/dashboard/src/routes/api/v1/billing/usage.ts` + Polar reporting
- Surface it: add `hostOverageThisMonth` (count) and `hostOverageUsd = count × plan.hostOverage.usdPer` to the `/billing/usage` response (so plan 16's card can show it).
- **Polar usage-based reporting (uncertain — gate carefully):** if Polar usage-based/metered billing is configured for the account, report `host_count` to Polar's meter/usage API (via `polar-subscription.ts`/`polar-config.ts`) on a monthly cron or at record time. If the Polar product/SDK path is **not** confirmed, DO NOT fake it — land steps A–E's local meter + surface, and mark host-overage `deferred` in the registry (below) with reason "local meter live; Polar usage reporting pending product setup". This keeps the paywall honest.

### F. Enforcement registry — `apps/dashboard/src/lib/billing/plan-enforcement.ts`
- Update `LIMIT_ENFORCEMENT.hosts`:
  - If Polar reporting is wired → `{ status:'enforced', gate:'user-connections.ts checkHostSoftCap → host-usage-store.recordHostOverage → Polar usage report' }`.
  - If only the local meter landed → keep `hosts` enforced for the *hard cap* aspect but add an explicit note/entry that host **overage billing** is `deferred` pending Polar reporting. Never mark overage `enforced` without a billing path.

### G. Tests — `apps/dashboard/src/lib/billing/host-usage-store.test.ts` (new) + extend `entitlements.test.ts`
- `Free hard-caps`: `checkHostSoftCap(FREE, 1).allowed === false`.
- `Pro soft-caps`: `checkHostSoftCap(PRO, 3).allowed === true`, `overageHosts === 1`; at 4 hosts → `overageHosts === 2`.
- `peak meter`: `recordHostOverage(owner, 1)` then `recordHostOverage(owner, 2)` → `getHostOverageThisMonth === 2`; a later `recordHostOverage(owner, 1)` keeps it at `2` (peak, not additive).
- `monthly math`: `hostOverageUsd = count × plan.hostOverage.usdPer` for Pro and Max.
- `fail-open`: no Clerk → `recordHostOverage` does not throw and the add is allowed.

## STOP conditions & drift check
- **STOP if** `packages/pricing` already defines `hostOverage` — reconcile with the existing field instead of redefining.
- **STOP if** the advertised per-host price in `apps/landing/src/data/pricing.ts` differs from what you're about to set in `plans.ts` — reconcile to ONE number (honest-paywall) before wiring.
- **STOP and mark `deferred`** (do not fabricate) if Polar usage-based reporting cannot be confirmed for the account/product — land the local meter and surface only.
- **STOP and ask** before changing `checkHostLimit`'s existing callers beyond the connection route; other routes may rely on the hard boundary.
- **Drift check:** `user-connections.ts` still gates via `checkHostLimit` and pools via `org-host-count.ts`. If host counting moved, update the soft-cap wiring to the real counter.

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/billing/host-usage-store.test.ts src/lib/billing/entitlements.test.ts --isolate
bun run lint
```

## Done criteria
- Paid tiers add a 4th+ host without a 402; Free still 402s at its cap.
- Over-limit host-months recorded as a **peak** count in `host_usage_monthly`; `/billing/usage` returns `hostOverageThisMonth` and `hostOverageUsd`.
- Monthly total computes as `base + overageHosts × plan.hostOverage.usdPer`; tests cover Pro and Max math.
- `plan-enforcement.ts` reflects reality: overage `enforced` only if Polar reporting is wired, else `deferred` with a reason.
- Fail-open verified (no Clerk → unlimited, unmetered); type-check, build, lint green.

Priority: P1 · Effort L · Depth: F · Wave: R (Revenue) · Lever: Revenue (land-and-expand)
