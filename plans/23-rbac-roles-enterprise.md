# 23 — RBAC roles for Enterprise (viewer / operator / admin)

## Kickoff prompt

```text
Execute plans/23-rbac-roles-enterprise.md ALONE (Wave E, Enterprise, Depth E — light
discovery first). Turn lib/rbac/rbac.ts from "community all-access" into a real
role→permission matrix (viewer/operator/admin) mapped from Clerk org roles, and gate write
routes (control tools, connections, alert rules).

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE: when edition != enterprise (or no Clerk), RBAC FAILS OPEN to a
  single all-access operator — community behaviour is byte-for-byte unchanged.
- RBAC is ENTERPRISE-edition-gated and must NOT degrade OSS.
- AI recommends DDL, never auto-applies — do not weaken that; RBAC only decides who may
  *invoke* a write/control route.
- Postgres = NO. Roles come from Clerk org roles; any cache is D1.

Resolve the OPEN QUESTIONS before writing app code. End with the Verification commands +
results.
```

## Current reality (audited)

- **Why (spec 23):** `lib/rbac/rbac.ts` is effectively **all-access** (community
  single-operator). Real teams need viewer / operator / admin scoping. Confirmed present:
  `apps/dashboard/src/lib/rbac/rbac.ts`, `rbac/index.ts`, `rbac/rbac.test.ts`.
- Edition gating: `apps/dashboard/src/lib/edition/edition.ts` (enterprise-feature surface).
- A separate `apps/dashboard/src/lib/feature-permissions/` (`server.ts`, `types.ts`) already
  gates some feature access — RBAC must **compose with**, not duplicate, it. `(verify)` the
  boundary between the two during discovery.
- Write/control surfaces to protect (locate exact routes during discovery): control/management
  tools (query kill / DDL execution endpoints), connection mutations
  (`apps/dashboard/src/routes/api/v1/user-connections.ts`), and any alert-rule mutation routes
  (alert-rule routes are thin today — the alerting-config surfaces from Wave A, e.g. plans
  26/27, are the write targets).

## Goal

Define **viewer / operator / admin** with an explicit permission matrix, map **Clerk org
roles** onto them, enforce on write paths server-side (viewer cannot kill queries or edit
connections; admin can), surface a role-management UI — and keep community/self-hosted
**all-access** and unchanged.

## Implement now

> Depth **E**: resolve open questions, then build. Keep the permission vocabulary small and
> explicit; enforcement is a server gate, never client-only.

**Approach & key files**
- `apps/dashboard/src/lib/rbac/rbac.ts` — define `Role = 'viewer' | 'operator' | 'admin'` and
  a static `Role → Permission[]` matrix (permissions like `connection:write`,
  `query:kill`, `control:execute`, `alert:configure`, `member:manage`). Export a pure
  `can(role, permission)` and a server helper `requirePermission(permission)` that resolves the
  caller's role from the Clerk org membership.
- **Clerk org-role mapping:** map Clerk org roles (e.g. `org:admin`, `org:member`) → chmonitor
  roles. Consume the group→role hint produced by **plan 21** (SSO) when present. `(verify)` the
  exact Clerk role identifiers in this project.
- **Enforce on write routes:** add `requirePermission(...)` at the top of each mutation handler
  — connections (`user-connections.ts`), control/management tools, and alert-config routes.
  Return 403 (not 402 — this is authz, not billing) when denied.
- **Fail-open:** `requirePermission` returns "allow / operator" when `edition != enterprise`
  **or** owner/org resolution throws (no Clerk). Community stays all-access. This is the single
  most important test.
- **UI:** minimal role-management surface (list members + role) gated on enterprise + the
  `member:manage` permission. Reads/writes Clerk org roles. `(verify)` whether an existing
  members UI can host it.
- No new persistence required if roles live in Clerk; if a role cache is needed, D1 only (new
  migration under `apps/dashboard/src/db/conversations-migrations/`). **No Postgres.**

**Open questions to resolve during discovery:**
1. **rbac vs feature-permissions boundary:** which decisions belong to `lib/rbac` (who: role
   on a write action) vs `lib/feature-permissions` (what: plan/edition capability)? Draw the
   line and avoid overlap. `(verify)`
2. **Exact Clerk org-role identifiers** available in this project and how membership role is
   read server-side.
3. **Canonical write-route inventory:** enumerate every mutation route that must be gated
   (control tools, connection CRUD, alert config) — produce the list before wiring.
4. **Denied-response contract:** confirm 403 + shape is consistent with the app's error
   handler (`lib/api/error-handler/`).
5. **Interaction with plan 21:** does SSO group→role fully drive roles, or can an admin
   override in-app? Decide precedence.

## STOP conditions & drift check

- **STOP** if enforcing a permission would block a community/self-hosted user from an action
  they can do today — RBAC must be invisible outside enterprise.
- **STOP** if the write-route inventory can't be enumerated confidently — an unguarded write
  route is a silent authz hole; list them all first.
- **Drift check:** if `rbac.ts` has already gained a real matrix, or `feature-permissions`
  now owns role logic, reconcile before adding a parallel system.
- Do not alter AI/DDL auto-apply behaviour; do not add Postgres.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/rbac --isolate
cd apps/dashboard && bun test src/lib/edition/edition.test.ts --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

- [ ] `Role → Permission[]` matrix + pure `can(role, permission)` in `lib/rbac/rbac.ts`
  (unit-tested per role).
- [ ] `requirePermission` gates every enumerated write/control route; **viewer** is denied
  `query:kill` / `connection:write`, **admin** allowed (route-level test).
- [ ] Clerk org roles map to chmonitor roles (unit test on the mapping).
- [ ] Community/self-hosted (edition != enterprise or no Clerk) is **all-access** and unchanged
  (fail-open test).
- [ ] Denied writes return 403 via the shared error handler; no 402/paywall confusion.
- [ ] No Postgres; any cache is D1.
- [ ] type-check, build, targeted tests, lint all green.

---

Priority P2 · Effort L · Depth E · Wave E (Enterprise) · Lever Enterprise
