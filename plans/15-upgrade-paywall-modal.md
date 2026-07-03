# 15 — Upgrade paywall modal

## Kickoff prompt

```text
Execute plans/15-upgrade-paywall-modal.md ALONE (do not touch other plans).
Goal: when a billing limit returns HTTP 402 (host/seat/ai_daily/ai_budget), stop
showing raw JSON — intercept it, classify the reason, and show a PaywallModal with
current-vs-next-tier caps and an "Upgrade" button that opens Polar checkout.
Invariants you must not violate:
  - Self-hosted/OSS stays whole: no 402s are emitted without Clerk, so the modal
    simply never fires on OSS. Do not add any gate; only react to existing 402s.
  - Honest paywalls: advertised ⟺ enforced (or `deferred`). Copy MUST distinguish a
    truly `enforced` limit from a `deferred` one — read lib/billing/plan-enforcement.ts;
    never claim a cap is enforced when the registry says deferred.
  - AI recommends DDL, never auto-applies (untouched).
  - Postgres/multi-DB: NO for 2026 H2.
Reuse lib/billing/entitlements.ts:limitMessage for copy and POST /api/v1/billing/checkout
for the upgrade action. End by running the Verification block and pasting results.
```

## Current reality (audited)

A 402 from any billing gate returns raw JSON that surfaces to the user as an error toast, not a conversion surface — the single biggest CVR leak.

- The gates that emit 402 already exist: `checkHostLimit` (`apps/dashboard/src/routes/api/v1/user-connections.ts` via `entitlements.ts:81`), `checkSeatLimit` (`entitlements.ts:86`), `checkAiDailyLimit` and `checkAiBudget` (`entitlements.ts:111`,`:131`; enforced in `agent.ts` around `:560–603`).
- Human-readable copy exists: `apps/dashboard/src/lib/billing/entitlements.ts:136` `limitMessage(check)`.
- The client error pipeline is a **directory**: `apps/dashboard/src/lib/api/error-handler/` (`error-classifier.ts`, `error-response-builder.ts`, `sanitize-error.ts`, `index.ts`, `types.ts`) — this is where a 402 must be classified into a `reason`.
- Checkout is one POST: `apps/dashboard/src/routes/api/v1/billing/checkout.ts` — `POST` with body `{ planId?, period? }` returns `{ url }` (`checkout.ts:99–107`, `createFileRoute('/api/v1/billing/checkout')`).
- **No** `paywall-modal.tsx` exists in `apps/dashboard/src/components/billing/` (present: `plan-card.tsx`, `plan-comparison.tsx`, `usage-summary.tsx`). This component is genuinely new.
- Plan caps to display come from `packages/pricing/src/plans.ts` (`hosts`, `seats`, `aiRequestsPerDay`, `aiMonthlyUsdBudget`).

## Goal

A 402 anywhere in the app opens a `PaywallModal` (not an error toast) that names the hit limit, shows current-tier vs next-tier caps, uses honest copy for `enforced` vs `deferred`, and routes "Upgrade" to the Polar checkout URL. Dismiss is clean; nothing fires on OSS (no 402s without Clerk).

## Implement now

### A. Classify 402 → reason — `apps/dashboard/src/lib/api/error-handler/error-classifier.ts`
- Ensure billing 402 responses carry a machine `reason`. The gate responses should already include a `reason` in their JSON body; if not present, standardize the four values: `'host' | 'seat' | 'ai_daily' | 'ai_budget'`.
- Add/extend a classifier export, e.g. `classifyBillingLimit(status: number, body: unknown): { reason: 'host'|'seat'|'ai_daily'|'ai_budget'; message: string } | null` — returns non-null only for `status === 402`. Fall back to `limitMessage`-style text when body has no `message`.
- Export the reason type from `error-handler/types.ts`.

### B. New component — `apps/dashboard/src/components/billing/paywall-modal.tsx`
```tsx
export function PaywallModal(props: {
  open: boolean
  reason: 'host' | 'seat' | 'ai_daily' | 'ai_budget'
  message: string                 // from limitMessage / classifier
  currentPlanId: string
  onClose: () => void
}): JSX.Element
```
- Render title from `reason` ("Host limit reached", "Seat limit reached", "Daily AI limit reached", "Monthly AI budget reached").
- Show a **current vs next tier** mini-table for the relevant metric only, read from `@chm/pricing` plans (`hosts`/`seats`/`aiRequestsPerDay`/`aiMonthlyUsdBudget`). Pick "next tier" as the first plan whose relevant cap exceeds current.
- **Honest copy:** import the enforcement registry (`apps/dashboard/src/lib/billing/plan-enforcement.ts`); if the mapped limit is `deferred`, render "This limit isn't billed during early access" language instead of an upgrade-required hard sell. Only show the hard upgrade CTA when the limit is `enforced`.
- "Upgrade" button → `POST /api/v1/billing/checkout` with `{ planId: <nextTierId> }`, then `window.location.assign(url)`. Use the existing dashboard API client (`apps/dashboard/src/lib/api/dashboard-api-client.ts`) so auth/headers match.
- Use the existing dialog primitive already used by other `components/billing/*` / shadcn dialogs; do not introduce a new modal library.

### C. Wire into the global error surface — `apps/dashboard/src/root.tsx` (or the existing error boundary/toast host)
- Add a small provider/hook `usePaywall()` that holds `{ open, reason, message, currentPlanId }` and a `showPaywall(...)` setter.
- In the central fetch/error handler (where 402 toasts are raised today), call `classifyBillingLimit`; when non-null, call `showPaywall(...)` and **suppress** the raw error toast. Non-402 errors keep existing behavior.
- Render `<PaywallModal … />` once at the app root, driven by the provider.

### D. Do NOT add new gates
This plan is UX only. It reacts to 402s that `entitlements.ts` already produces. No enforcement is added or changed (keeps the honest-paywall + fail-open invariants trivially true).

### E. Tests — `apps/dashboard/src/components/billing/paywall-modal.test.tsx` (Bun for logic; Cypress for interaction)
- Logic (Bun): `classifyBillingLimit` returns the right `reason` for each 402 shape and `null` for 200/500.
- Per-reason render (Cypress component test): each of the four reasons renders the correct title + current/next caps; an `enforced` limit shows the Upgrade CTA; a `deferred` limit shows the "not billed in beta" copy and no hard CTA.
- Upgrade path: clicking Upgrade POSTs to `/api/v1/billing/checkout` and navigates to the returned `url` (stub the client). Dismiss calls `onClose`.

## STOP conditions & drift check
- **STOP if** `checkout.ts` no longer returns `{ url }` or its body contract changed from `{ planId?, period? }` — adjust the Upgrade call and re-verify.
- **STOP if** the gates don't put a `reason` in their 402 body and you'd have to change server contracts broadly — scope it: add `reason` to the four gate responses in a minimal edit, don't refactor the error system.
- **STOP and ask** if `plan-enforcement.ts` marks all of host/seat/ai as `deferred` — then the modal is informational only and the Upgrade CTA must be hidden everywhere; confirm the desired copy.
- **Drift check:** `entitlements.ts` still exports `limitMessage`, `checkHostLimit`, `checkSeatLimit`, `checkAiDailyLimit`, `checkAiBudget`. If any is renamed/removed, the reason set changed — stop.

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/components/billing/paywall-modal.test.tsx --isolate
bun run lint
```

## Done criteria
- A 402 with reason ∈ {host, seat, ai_daily, ai_budget} opens `PaywallModal`; no raw JSON/error toast for that case.
- Modal shows current-vs-next-tier caps for the hit metric, honest `enforced`/`deferred` copy, and an Upgrade button that opens the Polar checkout URL.
- Dismiss closes cleanly; nothing renders on OSS (no 402 without Clerk).
- Per-reason tests pass; type-check, build, lint green.

Priority: P0 · Effort M · Depth: F · Wave: R (Revenue) · Lever: Revenue/Adoption (convert limit-hits)
