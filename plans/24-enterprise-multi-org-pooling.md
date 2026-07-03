# 24 — Enterprise multi-org pooling (one subscription, pooled limits)

## Kickoff prompt

```text
Execute plans/24-enterprise-multi-org-pooling.md ALONE (Wave E, Enterprise, Depth E — light
discovery first). Let a large customer run multiple Clerk orgs under ONE subscription with
POOLED limits (hosts / seats / AI / retention), billed to a designated parent org.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE; billing/plan resolution already FAILS OPEN without Clerk — keep
  it so (no Clerk → no pooling, unlimited local, unchanged).
- Pooling is an ENTERPRISE-edition feature; must NOT degrade OSS or change single-org
  behaviour when no org-group is configured.
- AI recommends DDL, never auto-applies (untouched here).
- Postgres = NO. The org-group mapping is a D1 table.

Resolve the OPEN QUESTIONS before writing app code. End with the Verification commands +
results.
```

## Current reality (audited)

- **Why (spec 24):** large customers run multiple Clerk orgs but want **one subscription +
  pooled limits**. Today plan/limit resolution is **per-org**.
- Billing-owner resolution + per-org limits live under `apps/dashboard/src/lib/billing/`.
  Confirmed files: `user-subscription.ts` (plan for owner), `org-host-count.ts` (host pooling
  within an org), `entitlements.ts` (limit checks). The spec's `billing-owner.ts` path is
  **`(verify)`** — the owner-resolution seam exists in `user-subscription.ts` /
  `org-host-count.ts`; confirm the exact function to override during discovery.
- Host counting is already "pooled by owner" for the single-org case
  (`countOwnerHosts` per the plan-02 audit) — this plan generalises *owner* from "one org" to
  "an org-group parent".

## Goal

Designate a **parent org**; child orgs **resolve the parent's plan**; hosts / seats / AI /
retention **pool across the group** and bill once to the parent; the portal shows unified
usage. With no org-group configured, behaviour is identical to today (single org).

## Implement now

> Depth **E**: the crux is a single **owner-resolution** indirection — "given a Clerk org,
> what billing owner do I count/limit/bill against?" Introduce an `org_group` lookup at that
> one seam and let existing pooling logic ride on top.

**Approach & key files**
- New D1 table `org_group` (e.g. `parent_org_id`, `child_org_id`, `created_at`;
  child unique) — migration under `apps/dashboard/src/db/conversations-migrations/` (next
  sequential `.sql`). A child with no row resolves to itself (no-op default).
- **Parent resolution helper** — the seam the spec calls `billing-owner.ts`: a
  `resolveBillingOwner(orgId)` that returns the parent when a group row exists, else the org
  itself. Locate the current per-org resolver in `user-subscription.ts` /
  `org-host-count.ts` and route it through this helper. `(verify)` exact function name/file.
- **Plan by parent:** `user-subscription.ts` resolves the plan for the *billing owner* (parent),
  so child orgs inherit the parent's tier.
- **Pool limits:** host/seat/AI/retention counts sum across all child orgs of the owner.
  `org-host-count.ts` already pools by owner — extend the owner set to "all children of the
  parent." AI usage + retention counters key on the billing owner.
- **Unified portal usage:** the billing usage surface reports the pooled totals for the group.
  (`(verify)` the usage route — `routes/api/v1/billing/usage.ts` exists.)
- **Edition gate:** org-group creation/management is enterprise-only; outside enterprise the
  table is never populated and every resolver returns the org itself.

**Fail-open:** owner resolution already throws without Clerk and call sites swallow it (OSS
pattern). The new `resolveBillingOwner` must preserve that — no Clerk → resolve to self →
unlimited local. This is a required test.

**Open questions to resolve during discovery:**
1. **Exact owner-resolution function** to indirect (`billing-owner.ts` is `(verify)`; the real
   seam is in `user-subscription.ts` / `org-host-count.ts`). Name it before wiring.
2. **Group topology:** flat parent→children only, or nested? Recommend flat (one level) for
   this plan; record the decision.
3. **Who may create a group** and how a parent is designated (enterprise admin action; ties to
   plan 23 `member:manage`).
4. **Seat pooling semantics:** sum of members across all child orgs vs. distinct users? Define
   the counting rule and test it.
5. **Portal reporting:** does Polar/portal show one subscription for the parent while chmonitor
   renders the pooled breakdown? Confirm the usage route surfaces group totals.

## STOP conditions & drift check

- **STOP** if introducing the group indirection changes single-org (no-group) results in any
  test — the default path must be a pure no-op.
- **STOP** if pooling would let a group exceed the parent plan silently — over-limit must still
  surface (402/paywall) against the *pooled* total.
- **Drift check:** if owner resolution has been refactored away from `user-subscription.ts` /
  `org-host-count.ts`, find the new seam before adding the group lookup.
- Do not add Postgres; do not touch AI/DDL behaviour.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/billing --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

- [ ] `org_group` D1 migration committed; a child org with no row resolves to itself.
- [ ] `resolveBillingOwner(orgId)` returns the parent for grouped children (unit test).
- [ ] Child orgs resolve the **parent's plan**; hosts/seats/AI/retention **pool** across the
  group (pooling-math tests: e.g. two children summing hosts hit the parent cap).
- [ ] Single-org (no group) behaviour is byte-for-byte unchanged (regression test).
- [ ] Pooled over-limit still triggers the paywall/402 against the group total.
- [ ] Fail-open preserved (no Clerk → self-resolution, unlimited local).
- [ ] No Postgres. type-check, build, targeted tests, lint all green.

---

Priority P2 · Effort L · Depth E · Wave E (Enterprise) · Lever Enterprise/TAM
