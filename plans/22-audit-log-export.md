# 22 — Audit log + org-scoped CSV export

## Kickoff prompt

```text
Execute plans/22-audit-log-export.md ALONE (Wave E, Enterprise, Depth F — file-level spec
below). Add an append-only audit_logs D1 table, a logEvent() helper, and an org-scoped,
date-filtered CSV export route, wired to member / billing / connection mutations.
Enterprise-edition-gated.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE; the audit gate FAILS OPEN without Clerk (no owner/org → logging
  is best-effort/no-op, never blocks the underlying mutation).
- Audit is ENTERPRISE-edition-gated (via lib/edition) and must NOT degrade OSS.
- AI recommends DDL, never auto-applies (unaffected).
- Postgres = NO. The log is a D1 table; export is CSV.

End with the Verification commands + results.
```

## Current reality (audited)

- **Why (spec 22):** SOC2/ISO buyers need an audit trail + export; **none exists**. No
  `audit_logs` table, no `lib/audit/`, no export route.
- Wiring targets confirmed present: Clerk webhook
  `apps/dashboard/src/routes/api/v1/webhooks/clerk.ts` (member add/remove); billing mutations
  under `apps/dashboard/src/routes/api/v1/billing/` (checkout/portal/webhooks) and Polar
  webhook; connection mutations `apps/dashboard/src/routes/api/v1/user-connections.ts`.
- D1 migrations are `.sql` files under `apps/dashboard/src/db/conversations-migrations/`
  (latest examples: `0005_ai_usage_daily.sql`, `0006_auth_identities.sql`). New migration =
  next sequential number.
- Edition gating: `apps/dashboard/src/lib/edition/edition.ts`.

## Goal

Every state-changing action (member, billing, connection mutations) appends an immutable row to
`audit_logs`; an enterprise admin can `GET` a **CSV export filtered by date and scoped to their
org only**. Logging never blocks the underlying mutation and is inert for OSS/self-hosted.

## Implement now

**A. Migration — new `apps/dashboard/src/db/conversations-migrations/NNNN_audit_logs.sql`**
(next sequential number). Append-only table:

```sql
CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,              -- uuid / crypto.randomUUID()
  event_time   TEXT NOT NULL,                 -- ISO-8601 UTC
  org_id       TEXT NOT NULL,                 -- scoping key (Clerk org id)
  user_id      TEXT,                          -- actor Clerk user id (nullable: system/webhook)
  event        TEXT NOT NULL,                 -- e.g. 'member.invited', 'billing.checkout', 'connection.created'
  resource     TEXT,                          -- affected resource id/label
  action       TEXT NOT NULL,                 -- 'create' | 'update' | 'delete' | 'invite' | ...
  result       TEXT NOT NULL,                 -- 'success' | 'denied' | 'error'
  ip           TEXT,                          -- request IP when available
  metadata     TEXT                           -- optional JSON string, small
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_time ON audit_logs (org_id, event_time);
```

**B. Helper — new `apps/dashboard/src/lib/audit/index.ts` (+ `logEvent.ts`)**

```ts
export interface AuditEvent {
  orgId: string
  userId?: string | null
  event: string
  resource?: string | null
  action: 'create' | 'update' | 'delete' | 'invite' | 'export' | string
  result: 'success' | 'denied' | 'error'
  ip?: string | null
  metadata?: Record<string, unknown>
}
// Best-effort append. MUST NOT throw into the caller: wrap the D1 write in
// try/catch and swallow on failure (audit is observational, never blocking).
// No-op when edition != enterprise OR org/owner cannot be resolved (fail-open).
export async function logEvent(env, e: AuditEvent): Promise<void>
```

- `event_time` = `new Date().toISOString()`; `id` = `crypto.randomUUID()`.
- Insert via the existing D1 binding used by other conversation-DB stores (`(verify)` the
  binding name, e.g. the same one `ai_usage_daily` uses).

**C. Export route — new `apps/dashboard/src/routes/api/v1/audit/export.ts`**
- Method: `GET`. Auth: enterprise-gated; requires an authenticated org admin (compose with
  plan 23 `member:manage` if present, else org-admin check).
- Query params: `from` (ISO date), `to` (ISO date). Both optional; default to last 30 days.
- **Org scoping is mandatory and server-derived** — the org id comes from the session, never
  from a query param, so a caller can only export their own org.
- Response: `text/csv` with `Content-Disposition: attachment; filename="audit-<org>-<from>-<to>.csv"`.
  Header row: `event_time,user_id,event,resource,action,result,ip`. Escape/quote fields (CSV
  injection + comma/quote safety).
- Emits its own `audit.export` event (`action:'export'`).

**D. Wire mutations to `logEvent`** (add a `logEvent(...)` call after the state change,
best-effort):
- `webhooks/clerk.ts` — member created/deleted (`member.invited` / `member.removed`).
- `billing/` mutations + Polar webhook — `billing.checkout`, `billing.plan_changed`,
  `billing.canceled`.
- `user-connections.ts` — `connection.created` / `connection.updated` / `connection.deleted`.
- Include `result:'denied'` on 402/403 rejections where cheap (optional but valuable for SOC2).

**E. Edition gate:** add an `audit` (or reuse `audit_log`) capability in `lib/edition`; the
export route 404/403s outside enterprise, and `logEvent` no-ops outside enterprise.

## STOP conditions & drift check

- **STOP** if a `logEvent` failure could ever surface to or roll back the underlying mutation —
  audit must be strictly non-blocking.
- **STOP** if org scoping could be influenced by a request param — the org id must be
  session-derived only.
- **Drift check:** if an `audit_logs` table or `lib/audit/` already exists, extend rather than
  recreate; if the D1 binding name differs from other stores, match the existing one.
- No Postgres; do not touch AI/DDL behaviour.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/audit --isolate
cd apps/dashboard && bun test src/routes/api/v1/audit --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

- [ ] `NNNN_audit_logs.sql` migration committed (append-only, `org_id`+`event_time` index).
- [ ] `logEvent` appends a row, never throws into the caller, no-ops outside enterprise / when
  org unresolved (unit tests cover success, swallow-on-error, and no-op).
- [ ] Member, billing, and connection mutations each produce an audit row (coverage test).
- [ ] `GET /api/v1/audit/export` returns org-scoped CSV filtered by `from`/`to`; org id is
  session-derived; a caller cannot export another org (scoping test).
- [ ] CSV fields are escaped/quoted (no CSV injection).
- [ ] No Postgres. type-check, build, targeted tests, lint all green.

---

Priority P2 · Effort M · Depth F · Wave E (Enterprise) · Lever Enterprise
