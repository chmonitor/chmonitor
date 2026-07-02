# 16 — Onboarding & First-Run Painpoints (+ Data Export)

> Priority: P1 · Effort: M · Risk: LOW · Depends on: none (soft-links 13 billing, 01 private hosts)
> Category: Adoption · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

The "install on a Friday night and immediately see something useful" path has
avoidable friction:

1. **Self-hosted first run is env-var-heavy.** `components/host/first-run-empty-state.tsx`
   picks one of three bodies (`ConnectYourHost` cloud+signed-in / `SignInToConnect`
   cloud+anon / `SelfHostedSetup` OSS). The OSS body leads with
   `CLICKHOUSE_HOST`/`USER`/`PASSWORD` env vars (+ restart) and buries the
   "add a host from this browser" button — the fastest path to first value. After
   a connection is added there is no "here's the one useful thing to look at now"
   handoff; the user lands on `/overview` cold.
2. **Connection errors are classified but the happy path is thin.** The classifier
   (`lib/connection-errors.ts` → `ConnectionErrorPanel` in `connection-form.tsx`,
   test-connection via `/api/v1/browser-connections/test`) is good on failure, but
   there's no "connected — here's what we found" success moment (version + table
   count + a jump link) to reward a correct connection.
3. **`data_export` is advertised but half-real.** `packages/pricing/src/plans.ts`
   lists `data_export` on Pro/Max/Enterprise, yet `lib/billing/plan-enforcement.ts`
   marks it `status: 'deferred'`. A **CSV export already exists and ships to
   everyone** ungated (`components/data-table/buttons/csv-export-button.tsx`, wired
   in `components/data-table/components/data-table-header.tsx`) — current-page and
   all-data CSV — but there is **no JSON export** and **no plan gating**, so the
   advertised paid feature is neither differentiated nor enforced.

## Goal

A first-time self-hoster reaches a **useful, populated view within one connection
step** (add host → test → "connected, N tables, go to Overview"), and **data
export** becomes a real, gated capability: add **JSON export** next to the
existing CSV, and gate both behind `data_export` for Pro/Max (open on OSS /
self-hosted), flipping `data_export` from `deferred` → `enforced`.

## Design

### A. Reduce first-run friction (self-hosted)

- In `SelfHostedSetup` (`first-run-empty-state.tsx`): **lead with the browser
  "Add a host" action** (primary button) and demote env-var instructions to a
  collapsible "Prefer env vars?" section. Keep the env-var content — do not remove
  a self-host path (self-hosted-stays-whole). Soft-link plan 01: mention
  `CHM_ALLOW_PRIVATE_HOSTS` in the LAN/Tailscale hint.
- **Success moment** in `connection-form.tsx`: on a successful
  `/api/v1/browser-connections/test`, the response already returns `version`. Add
  a lightweight follow-up (reuse the connected host) to show
  **"Connected — ClickHouse {version}, {N} tables"** with a primary
  **"Go to Overview"** CTA, so testing a connection ends on value, not a bare
  green check. `N tables` = `SELECT count() FROM system.tables WHERE database NOT IN ('system','INFORMATION_SCHEMA','information_schema')`.
- Use the shared `EmptyState` (`components/ui/empty-state.tsx`) variants for the
  pre-connection state so the first screen matches the design system.

### B. Data export — make the advertised feature real + gated

- Add **JSON export** beside CSV: extend
  `components/data-table/buttons/csv-export-button.tsx` (or add a sibling
  `data-export-button.tsx`) with "Export JSON (current page / all data)" using the
  same `table.getCoreRowModel().rows` + `getAllLeafColumns()` serialization,
  emitting `JSON.stringify(rows.map(r => Object.fromEntries(cols.map(c => [c.id, r.getValue(c.id)]))))`.
- **Gate export by capability.** Add a client hook `useCapability('data_export')`
  (thin wrapper over the billing subscription + `hasCapability` from
  `packages/pricing`, mirroring server `requirePlanCapability`). In
  `data-table-header.tsx`, render the export menu enabled when the capability is
  present; otherwise show it with an upgrade affordance (disabled + tooltip/upsell)
  — **open on OSS/self-hosted** (the hook returns `true` when billing can't be
  resolved, matching `requirePlanCapability`'s fail-open-to-OSS behaviour).
- Flip `data_export` `deferred` → `enforced` in `plan-enforcement.ts`
  (`gate: 'components/data-table/... useCapability(data_export)'`) and update the
  pricing/docs copy so "CSV/JSON export" is accurate.

### Files to add / edit

- EDIT `components/host/first-run-empty-state.tsx` (lead-with-browser, collapsible env section, private-host hint).
- EDIT `components/connections/connection-form.tsx` (connected success panel + table count + "Go to Overview").
- ADD `lib/billing/use-capability.ts` (client `useCapability`, fail-open to OSS).
- EDIT `components/data-table/buttons/csv-export-button.tsx` (+ JSON) and `components/data-table/components/data-table-header.tsx` (capability gate + upsell).
- EDIT `lib/billing/plan-enforcement.ts` (`data_export` → `enforced`).
- EDIT `docs/content/**` pricing/export docs (user-facing).

## Steps

1. `useCapability` hook (fail-open to OSS) + unit test.
2. Add JSON export to the export button; keep CSV behaviour identical.
3. Gate the export menu in `data-table-header.tsx` via `useCapability('data_export')` (+ upgrade upsell when absent, open on OSS).
4. Flip `data_export` → `enforced` in `plan-enforcement.ts`; update pricing/export docs.
5. `SelfHostedSetup`: promote browser "Add a host", collapse env-var block, add private-host hint.
6. `connection-form.tsx`: success panel with version + table count + "Go to Overview".
7. Tests (below); update roadmap status row.

## Real test

`lib/billing/use-capability.test.ts` (Bun) — **fails today** (hook absent),
passes after; asserts the OSS-open invariant and paid gating (the load-bearing
behaviour of the whole export-gating change):

```ts
import { describe, expect, test } from 'bun:test'
import { resolveCapability } from './use-capability' // pure resolver behind the hook

describe('data_export capability resolution', () => {
  test('fails OPEN when no billing context (self-hosted / OSS)', () => {
    expect(resolveCapability('data_export', null)).toBe(true)
  })
  test('free plan does NOT get data_export', () => {
    expect(resolveCapability('data_export', { planId: 'free' })).toBe(false)
  })
  test('pro plan gets data_export', () => {
    expect(resolveCapability('data_export', { planId: 'pro' })).toBe(true)
  })
})
```

Plus a component test `csv-export-button.cy.tsx` extension asserting the JSON menu
item exports every core-model row (mirrors the existing data-table Cypress
harness).

## Verification

```
cd apps/dashboard && bun test src/lib/billing/use-capability.test.ts
bun run lint && bun run build
bun run test:component:headless   # for the export-button component test
```

## Out of scope / STOP conditions

- No scheduled/emailed exports, no server-side export endpoint (client-side CSV/JSON only this plan).
- No full onboarding wizard/tour — just the lead-with-browser change + success moment.
- Do NOT remove or gate any core monitoring feature on OSS; export stays open on self-hosted (fail-open to OSS).
- No change to cloud auth / demo-host framing (owned by `first-run-empty-state` cloud modes; leave those bodies intact).
- STOP and split if the connection "success moment" needs new server routes — ship the friction + export changes first.

## Done

- [ ] Self-hosted first run leads with the browser "Add a host" path; env vars collapsed; private-host hint present.
- [ ] Connection test ends on a "connected, N tables, Go to Overview" success moment.
- [ ] JSON export added; CSV+JSON gated by `useCapability('data_export')`, open on OSS, upsell on paid-locked.
- [ ] `data_export` flipped to `enforced` in `plan-enforcement.ts`; pricing/export docs accurate.
- [ ] Real test fails before / passes after; `bun run lint && bun run build` green.
- [ ] Update the status row for **16** in `plans/roadmap/README.md` (→ IN REVIEW/DONE).
- [ ] Cross-link plan 13 (billing GA) for the paywall UX and plan 01 (private hosts) for the LAN hint.
