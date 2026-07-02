# 13 — Billing Paywall GA

> Priority: P0 · Effort: L · Risk: HIGH · Depends on: 14 (pricing page copy for overage), 19 (alerting must exist before its gate flips) · none blocking for the money-path itself.
> Category: Revenue · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

The billing machinery is wired but toothless. `packages/pricing/src/plans.ts` advertises Free / Pro $29 / Max $99 / Enterprise, yet:

- Almost every capability in `apps/dashboard/src/lib/billing/plan-enforcement.ts` is `status: 'deferred'` with `reason: BETA` ("Free during early access"). Only `api_mcp_access`, `hosts`, `seats`, `retentionDays`, `aiRequestsPerDay`, `aiMonthlyUsdBudget` are `enforced`.
- **No Polar products exist.** `plan.polarProductId` is unset; `productIdFor()` reads `CHM_POLAR_PRODUCT_<PLAN>_<PERIOD>` env vars that are not set, so `/api/v1/billing/checkout` returns 501 for every plan. Nobody can actually pay.
- **AI overage is published but never billed.** `plans.ts` declares `aiOverage: { usdPer: 5, messages: 2000 }` and `checkAiDailyLimit` deliberately returns `allowed: true` past the included allowance for paid tiers, but `apps/dashboard/src/lib/billing/ai-usage-store.ts` only *tracks* spend (`ai_usage_monthly`). No overage line item ever reaches Polar → we eat the LLM cost.
- **Per-host overage doesn't exist.** Host cap is a hard 402 in `routes/api/v1/user-connections.ts` (`checkHostLimit`); there's no "pay $15–19/host above your tier" path, which is the highest-signal expansion lever.
- **SSO/RBAC/audit** is sold at Enterprise (`sso_rbac_audit` capability) but `deferred` — fine, because it isn't built; it must *stay* deferred until it is.
- Early-access users were promised "free during early access." Flipping gates without grandfathering would break trust and churn our earliest fans. There is **no grandfather flag** anywhere in `subscription-store.ts` today.

GA = turn deferred→enforced deliberately, per gate, each behind a test, with early-access accounts grandfathered — while OSS stays 100% unenforced.

## Goal

**A cloud org on the Free plan is hard-blocked (HTTP 402) from a GA-enforced paid capability, a Pro org past its included AI allowance accrues a real Polar overage line item, and any account flagged `early_access` bypasses both — proven by a test per flipped gate.** (Measurable: `bun run test:unit` includes ≥1 passing test per gate flipped this plan, and `productIdFor('pro','monthly')` resolves to a real Polar product in the configured env.)

## Design

### A. Grandfathering (do this FIRST — nothing else is safe without it)

Add an `early_access` flag to the subscription row so a GA gate can wave through legacy accounts.

- Migration: new column on the subscriptions table used by `apps/dashboard/src/lib/billing/subscription-store.ts` (see its `CREATE TABLE` / `D1SubscriptionRow`). Add `early_access INTEGER NOT NULL DEFAULT 0` (D1 has no bool). Backfill `1` for every existing row (everyone who signed up during beta is grandfathered).
- Surface it on the resolved plan context. `UserSubscription` (subscription-store.ts) gains `earlyAccess: boolean`; map `row.early_access === 1`.
- New helper `lib/billing/grandfather.ts`:
  ```ts
  // Returns true when this owner was onboarded during early access and a GA gate
  // must NOT block them. OSS never reaches here.
  export function isGrandfathered(sub: UserSubscription | null): boolean {
    return sub?.earlyAccess === true
  }
  ```
- Every gate flipped below calls `isGrandfathered()` *before* denying. Grandfathered = behaves as if capability granted (but still metered for visibility).

### B. Polar products + wiring (unblock payment)

- Create Polar products (sandbox first) for `pro`/`max` × `monthly`/`yearly` = 4 products, matching `plans.ts` prices ($29/$290, $99/$990). Do this in the Polar dashboard; capture the 4 product ids.
- Set env in `apps/dashboard` (wrangler secrets / `.dev.vars` / `.env.example`): `CHM_POLAR_PRODUCT_PRO_MONTHLY`, `_PRO_YEARLY`, `_MAX_MONTHLY`, `_MAX_YEARLY`, plus `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `CHM_POLAR_SERVER`. `polar-config.ts` already reads these — no code change to the mapping.
- **Meter products for usage.** Create two Polar metered/usage products or benefits: `ai_overage` ($5 per 2,000 messages) and `host_overage` ($15–19 per host/mo above tier cap). Capture their ids into `CHM_POLAR_METER_AI_OVERAGE`, `CHM_POLAR_METER_HOST_OVERAGE`.
- Optional but recommended: set `plan.polarProductId` in `plans.ts` to a *doc-only* echo of the env keys (keep the runtime source in env per the file's existing contract — do NOT hardcode ids into the OSS package).

### C. Per-host overage (expansion lever)

- Extend `plans.ts`: add `hostOverageUsd: number | null` (Pro/Max: e.g. `17`; Free: `null` = hard cap; Enterprise: `null` = unlimited).
- `entitlements.ts` `checkHostLimit`: keep the count math, but return a new field `overageAllowed: boolean` when `plan.hostOverageUsd != null`. Do NOT hard-402 for overage-eligible plans.
- `routes/api/v1/user-connections.ts` `handlePost`: when over cap AND `overageAllowed` AND (cloud) → allow the connection, and record a host-overage usage event to Polar (D). When over cap AND NOT overage-eligible (Free) → keep the existing 402. Grandfathered → allow, no charge.

### D. AI overage → invoice (stop eating LLM cost)

- `ai-usage-store.ts` already accumulates `ai_usage_monthly.spent_usd` and knows daily counts (`ai_usage_daily`). Add `lib/billing/polar-meter.ts`:
  ```ts
  // Report N overage messages / host-months to Polar's usage meter for this
  // owner's active subscription. No-op when D1/Polar unconfigured (OSS/dev).
  export async function reportAiOverage(ownerId, overageMessages): Promise<void>
  export async function reportHostOverage(ownerId, extraHosts): Promise<void>
  ```
  Implement with `getPolarClient().events.ingest(...)` (Polar usage/meter ingestion) keyed by `externalCustomerId = ownerId`, guarded by `isBillingConfigured()` and a present meter id.
- In `routes/api/v1/agent.ts` (the `checkAiDailyLimit` call site): after a successful generation on a paid tier, if today's post-increment count > `plan.aiRequestsPerDay`, call `reportAiOverage(ownerId, 1)`. Grandfathered/Enterprise/Free-hardcap → skip.
- Polar rolls metered usage into the next invoice; no invoice code here beyond ingestion.

### E. Flip deferred→enforced, one gate per test

Only flip capabilities whose feature **actually exists**. As of this commit the safe flips are the beta-free ones that already have a working feature behind them. For each flip: (1) add the gate call at the feature's entry point, (2) change the line in `plan-enforcement.ts` from `deferred` to `enforced` with a real `gate:` string, (3) add a test.

- `ai_agent` — already metered; flip means Free's hard daily cap + gating the agent route behind `hasCapability(plan,'ai_agent')` (Free has it, so this is mostly the meter already live; keep `enforced` note pointing at `checkAiDailyLimit`).
- `ai_insights_scheduled`, `data_export`, `anomaly_detection`, `custom_dashboards`, `fleet_view`, `webhook_integrations` — flip **only the ones whose feature is shipped**; wrap each feature's server entry with `requirePlanCapability(cap)` (see `lib/billing/plan-capability.ts`, already used by `routes/api/mcp.ts`). If a feature is not shipped, **leave it `deferred`** — do not invent a gate.
- `alerting_basic` / `alerting_advanced` — **stays deferred until plan 19 ships alerting.** This plan must not flip it.
- `sso_rbac_audit` — **stays deferred until SSO/RBAC/audit is built** (out of scope here). Enterprise contract is sold manually meanwhile.
- `alertRules` limit — stays deferred (no create path yet, per registry).

### F. Guardrails (the invariant)

Every gate added routes through the existing owner/plan resolution that **throws without Clerk** and is swallowed at the call site to leave OSS ungated. Mirror the existing `enforced` gates exactly (host/seat/AI). Add a shared `enforceOrThrowFailOpen()` note in `plan-capability.ts` if not present so new call sites can't get the fail-open wrong.

## Steps

1. **[S] Grandfather flag.** Migration adds `early_access` column + backfill `1`; extend `UserSubscription`/`D1SubscriptionRow`/upsert in `subscription-store.ts`; add `lib/billing/grandfather.ts` `isGrandfathered()`. Test: a row with `early_access=1` → `isGrandfathered` true; default new row → false.
2. **[S] Polar products + env.** Create 4 plan products (sandbox), set `CHM_POLAR_PRODUCT_*` + `POLAR_*` env, document in `.env.example`. Verify `/api/v1/billing/checkout` returns a `url` (not 501) for pro/monthly against sandbox. (Manual/infra step — record product ids in the PR description, add keys to `.env.example`.)
3. **[S] AI overage ingestion.** Add `lib/billing/polar-meter.ts` `reportAiOverage`; call it from `routes/api/v1/agent.ts` after a paid-tier overage message; skip for Free/Enterprise/grandfathered. Test: paid plan at `count = aiRequestsPerDay + 1` → `reportAiOverage` called once with `1`; Free at cap → not called (hard-blocked); grandfathered → not called.
4. **[M] Per-host overage.** Add `hostOverageUsd` to `plans.ts` (+ pricing test); add `overageAllowed` to `checkHostLimit` in `entitlements.ts`; branch `user-connections.ts handlePost` to allow-with-charge vs 402; add `reportHostOverage`. Test: Pro at `hosts+1` with overage → connection allowed + `reportHostOverage(ownerId,1)`; Free at `hosts+1` → 402 unchanged; grandfathered Pro → allowed, no charge.
5. **[M] Flip the safe capability gates (split — one child unit per gate).** For each *shipped* capability in E: wrap the feature entry with `requirePlanCapability`, flip its `plan-enforcement.ts` line to `enforced` with a real `gate:` string, add a per-gate test. Ship each gate as its own commit; a gate whose feature isn't shipped stays `deferred` and is skipped. **This is the L unit — its split is: one ≤S child per capability actually flipped (ai_insights_scheduled, data_export, anomaly_detection, custom_dashboards, fleet_view, webhook_integrations — include only those whose feature exists at implementation time).**
6. **[S] Grandfather bypass wired into every flipped gate.** Ensure each new gate calls `isGrandfathered()` before denying; add one test asserting a grandfathered Free-equivalent org passes a GA-enforced gate.
7. **[XS] Update `plan-enforcement.test.ts` expectations** so the registry test still passes (each flip changes the expected status) and the "no enforced claim without a gate string" assertion holds.

## Real test

New/updated Bun tests (dashboard), each failing today, passing after:

- `subscription-store` / `grandfather.test.ts`: `isGrandfathered({earlyAccess:true})` → true; default → false. *(fails today: field + helper don't exist)*
- `ai-overage.test.ts`: with a stubbed `reportAiOverage`, a Pro plan whose `reserveAiUsage` returns `aiRequestsPerDay + 1` triggers exactly one overage report; Free at cap triggers none; grandfathered triggers none. *(fails today: no ingestion path)*
- `host-overage.test.ts`: `checkHostLimit(proPlan, plan.hosts)` returns `overageAllowed: true`; `user-connections handlePost` at `hosts+1` for Pro allows and reports; Free 402s. *(fails today: no `overageAllowed`/`hostOverageUsd`)*
- `plan-enforcement.test.ts`: each capability flipped this plan asserts `status === 'enforced'` and a non-empty `gate` naming a real file; `alerting_*` and `sso_rbac_audit` still `deferred`. *(fails today: they're `deferred`)*

## Verification

```bash
cd apps/dashboard && bun run test:unit         # all billing tests green
cd packages/pricing && bun run test:unit       # hostOverageUsd shape covered
bun run lint
bun run build
# Manual (sandbox): POST /api/v1/billing/checkout {planId:'pro',period:'monthly'} → 200 {url}
# Manual (sandbox): drive a Pro org past aiRequestsPerDay; confirm a usage event lands in Polar
```

## Out of scope / STOP conditions

- **Self-hosted stays whole.** When auth is `none` / no Clerk / no billing config, every gate added here fail-opens to unlimited (mirror the existing host/seat gates). No OSS default changes in `plans.ts` semantics for `auth: none`.
- **Never enforce an unbuilt gate.** Do NOT flip `alerting_basic`, `alerting_advanced`, `sso_rbac_audit`, or `alertRules`. They stay `deferred` until their feature ships (19 for alerting; a separate SSO plan for Enterprise). A flip requires a real feature entry point AND a test.
- No dunning / failed-payment retry UX, no proration UI, no tax config — Polar handles invoicing; those are separate.
- Do not hardcode Polar product ids into `packages/pricing` (OSS package stays env-driven).
- Do not remove the early-access grandfather before a published sunset date (separate comms decision).

## Done

- [ ] `early_access` column + `isGrandfathered()` shipped, existing rows backfilled to grandfathered.
- [ ] 4 Polar plan products live; checkout returns a URL; env documented in `.env.example`.
- [ ] AI overage reported to Polar for paid tiers past included allowance; Free/Enterprise/grandfathered excluded.
- [ ] Per-host overage (`hostOverageUsd`) allows-with-charge on Pro/Max; Free still 402s.
- [ ] Each *shipped* capability flipped `deferred`→`enforced` with a real gate + test; unbuilt gates left `deferred`.
- [ ] `plan-enforcement.test.ts` updated and green; a grandfathered-bypass test passes.
- [ ] `bun run lint && bun run build` green; `apps/dashboard` + `packages/pricing` unit tests green.
- [ ] Status row for **13** updated in `plans/roadmap/README.md`.
