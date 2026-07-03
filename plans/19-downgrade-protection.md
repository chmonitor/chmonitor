# 19 — Downgrade protection

## Kickoff prompt

```text
Execute plans/19-downgrade-protection.md ALONE (do not touch other plans).
Goal: before sending a user to the Polar portal to downgrade, compare their CURRENT
usage to the TARGET plan's limits; if current usage exceeds the target, warn with the
exact exceeded limits and offer "Stay on <current>" vs "Downgrade anyway".
Invariants you must not violate:
  - Self-hosted/OSS stays whole: usage/plan resolution FAILS OPEN without Clerk; on
    OSS the check returns "ok" (nothing to protect) and never blocks.
  - Honest paywalls: advertised ⟺ enforced (or `deferred`). Only warn on limits that
    are actually enforced per lib/billing/plan-enforcement.ts; a `deferred` limit must
    not manufacture a scary warning.
  - AI recommends DDL, never auto-applies (untouched).
  - Postgres/multi-DB: NO for 2026 H2.
Reuse the same usage source as the billing card (GET /api/v1/billing/usage) and the
existing check* helpers in lib/billing/entitlements.ts. End by running Verification.
```

## Current reality (audited)

Users can downgrade below their current usage and silently lose access to hosts/seats — a retention/quality hole.

- Usage is available: `apps/dashboard/src/routes/api/v1/billing/usage.ts` returns `hosts`, `seats`, `aiMessages` (each `{ used, limit, unlimited }`) plus `renewal`.
- Limit helpers exist: `apps/dashboard/src/lib/billing/entitlements.ts` — `checkHostLimit`, `checkSeatLimit`, `checkAiDailyLimit`, `checkAiBudget`, and `limitMessage` (`entitlements.ts:81–136`).
- Plan catalog: `packages/pricing/src/plans.ts` (per-tier `hosts`, `seats`, `aiRequestsPerDay`, `aiMonthlyUsdBudget`, `retentionDays`).
- Downgrade is initiated by opening the Polar portal: `apps/dashboard/src/routes/api/v1/billing/portal.ts` → `{ url }`. There is **no pre-portal check** and **no confirm modal**.
- No `can-downgrade.ts` route and no downgrade confirm component exist yet.

## Goal

A `can-downgrade` check compares current usage against a target plan; the UI blocks the "downgrade" affordance behind a warning modal listing every exceeded limit, offering "Stay" vs "Downgrade anyway" (which proceeds to the portal and logs the choice). It only warns on enforced limits and is a no-op on OSS.

## Implement now

### A. Route — `apps/dashboard/src/routes/api/v1/billing/can-downgrade.ts` (new)
```ts
// POST /api/v1/billing/can-downgrade
// body: { targetPlanId: string }
// returns: { ok: boolean; exceeded: Array<{ metric: 'hosts'|'seats'|'aiRequestsPerDay'|'retentionDays'; used: number; targetLimit: number|null; message: string }> }
```
- Resolve the owner's current usage (reuse the internal resolvers behind `usage.ts`: pooled hosts, seats/member count, AI usage) and the **target** plan from `@chm/pricing`.
- For each metric that is **enforced** (consult `plan-enforcement.ts` `LIMIT_ENFORCEMENT`), compare `used > targetLimit` (respect `unlimited`/`null`). Build `exceeded[]` with `limitMessage`-style copy.
- `ok = exceeded.length === 0`.
- **Fail-open:** if plan/usage resolution throws (no Clerk), return `{ ok: true, exceeded: [] }` — OSS has nothing to protect.
- Use `createFileRoute('/api/v1/billing/can-downgrade')` with a `POST` handler, mirroring `checkout.ts`/`portal.ts` structure and the shared error mapper.

### B. Confirm modal — `apps/dashboard/src/components/billing/downgrade-confirm-modal.tsx` (new)
```tsx
export function DowngradeConfirmModal(props: {
  open: boolean
  targetPlanId: string
  exceeded: Array<{ metric: string; used: number; targetLimit: number|null; message: string }>
  onStay: () => void            // close, no-op
  onProceed: () => void         // open Polar portal + log
  onClose: () => void
}): JSX.Element
```
- If `exceeded` is non-empty: warn ("Downgrading to <target> will exceed its limits:") and list each exceeded metric with `used` vs `targetLimit`. Primary action "Stay on current plan"; secondary/destructive "Downgrade anyway".
- If `exceeded` is empty: this modal shouldn't be shown (the caller proceeds straight to the portal).
- Reuse the app's existing dialog primitive (same one the other `components/billing/*` dialogs use).

### C. Wire the downgrade affordance — billing UI
- Wherever a "downgrade" / "change to a lower plan" action exists (the billing card from plan 16, or the Polar-portal CTA), intercept: first `POST /api/v1/billing/can-downgrade { targetPlanId }`.
  - `ok === true` → proceed directly to `POST /api/v1/billing/portal` → `window.location.assign(url)`.
  - `ok === false` → open `DowngradeConfirmModal` with `exceeded`. "Downgrade anyway" → portal + a client log/telemetry event `billing.downgrade.override` (which limits were exceeded); "Stay" → close.

### D. Logging
- Record the override decision (who, target plan, exceeded metrics) via the app's existing logging/telemetry path used elsewhere in billing; if none is wired, a structured `console.info` gated behind the existing debug flag is acceptable (mirror the agent-route logging discipline). No PII beyond owner id.

### E. Tests — `apps/dashboard/src/routes/api/v1/billing/can-downgrade.test.ts` (new)
- **Free→Pro** (an *upgrade* target above current usage) → `ok: true`, empty `exceeded`.
- **Max→Pro with 5 hosts** where Pro caps at 3 → `ok: false`, `exceeded` includes `hosts` with `used: 5, targetLimit: 3`.
- **Seats**: current members > target seats → seats appears in `exceeded`.
- **deferred metric ignored**: a metric marked `deferred` in `plan-enforcement.ts` never appears in `exceeded` even if numerically over.
- **fail-open**: no Clerk → `{ ok: true, exceeded: [] }`, no throw.

## STOP conditions & drift check
- **STOP if** there is no downgrade/lower-plan affordance in the UI yet (plan 16 not merged) — still ship the `can-downgrade` route + modal and wire them behind the portal CTA; note the dependency.
- **STOP if** usage resolution can't be reused from `usage.ts` without duplicating logic — extract a shared `resolveOwnerUsage(owner)` helper used by both routes rather than copy-paste.
- **STOP and ask** if the desired behavior is to *hard-block* downgrades over usage (vs. warn-and-allow) — this plan implements warn-and-allow ("Downgrade anyway"); confirm before making it a hard block.
- **Drift check:** `entitlements.ts` still exports `checkHostLimit/checkSeatLimit/limitMessage`. If renamed, update the comparison logic.

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/routes/api/v1/billing/can-downgrade.test.ts --isolate
bun run lint
```

## Done criteria
- `POST /api/v1/billing/can-downgrade` returns `{ ok, exceeded[] }`, comparing current usage to the target plan on enforced limits only, and fails open on OSS.
- Over-limit downgrades open a warning modal listing exceeded limits with "Stay" vs "Downgrade anyway"; anyway proceeds to the Polar portal and logs the override.
- Downgrades within target limits skip the modal and go straight to the portal.
- Free→Pro and Max→Pro tests pass; deferred-metric and fail-open cases covered; type-check, build, lint green.

Priority: P1 · Effort S · Depth: F · Wave: R (Revenue) · Lever: Revenue (retention)
