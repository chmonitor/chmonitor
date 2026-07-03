# 27 — Alert history (persisted alert_events + filtered API + UI card)

## Kickoff prompt

```text
Execute plans/27-alert-history-audit-log.md ALONE (Wave A, Alerting, Depth F — file-level spec
below). Persist every dispatched alert to a D1 alert_events table, expose a filtered read API,
and add a recent-history card to health settings. Hook the write into the sweep right after a
successful delivery.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE: history persistence is best-effort; a D1 write failure must NEVER
  break the sweep or the outbound alert. Alerting works on every deployment (no Clerk required).
- Enterprise features are edition-gated and must NOT degrade OSS — alert history is a CORE
  alerting capability, NOT enterprise-gated.
- AI recommends DDL, never auto-applies (unaffected).
- Postgres = NO. History is a D1 table.

End with the Verification commands + results.
```

## Current reality (audited)

- **Why (spec 27):** dedup/cooldown state is **in-memory only** (lost on restart) and there is
  **no queryable record** of dispatched alerts for audit/debugging.
- Confirmed seam: `apps/dashboard/src/lib/health/alert-state-store.ts` exports
  `evaluateAlert(store, …)` returning a decision (`decision.notify: boolean`,
  `decision.kind: 'recovery' | …`), plus `decideNotification`, `alertStateStore`
  (`MemoryAlertStateStore`), `alertStateKey(hostId, ruleId)`.
- `apps/dashboard/src/lib/health/server-sweep.ts` calls
  `const decision = evaluateAlert(alertStateStore, {…})` (~line 245) and, inside
  `if (decision.notify) { … }` (~line 251), dispatches and tracks `recoveries` when
  `decision.kind === 'recovery'` (~line 262). **The history write hooks here, after a
  successful delivery.**
- D1 migrations are `.sql` under `apps/dashboard/src/db/conversations-migrations/`
  (e.g. `0005_ai_usage_daily.sql`); new migration = next sequential number. `(verify)` the D1
  binding name used by existing stores and reuse it.
- History card target: `apps/dashboard/src/components/health/health-settings-dialog.tsx`
  `(verify)` filename.

## Goal

After each successful alert delivery, a row is appended to `alert_events` capturing the
decision + delivery outcome; a `GET` history API returns rows filtered by host and/or day; a
health-settings card lists recent alerts. Persistence is strictly non-blocking and works on all
editions/deployments.

## Implement now

**A. Migration — new `apps/dashboard/src/db/conversations-migrations/NNNN_alert_events.sql`**
(next sequential):

```sql
CREATE TABLE IF NOT EXISTS alert_events (
  id             TEXT PRIMARY KEY,       -- crypto.randomUUID()
  event_time     TEXT NOT NULL,          -- ISO-8601 UTC (payload.timestamp or now)
  host_id        INTEGER NOT NULL,
  host_label     TEXT,
  rule           TEXT NOT NULL,          -- metric / rule id
  severity       TEXT NOT NULL,          -- 'warning' | 'critical' | 'recovery'
  prev_severity  TEXT,                   -- prior severity from the decision, if any
  decision_kind  TEXT NOT NULL,          -- decision.kind (e.g. 'fire' | 'recovery' | 're-notify')
  delivered      INTEGER NOT NULL,       -- 1 delivered, 0 attempted-but-failed
  error          TEXT,                   -- delivery error message when delivered = 0
  value          REAL,                   -- observed value (payload.value)
  channel        TEXT                    -- adapter id ('slack'|'email'|'opsgenie'|…), when known
);
CREATE INDEX IF NOT EXISTS idx_alert_events_host_time ON alert_events (host_id, event_time);
```

**B. Store — new `apps/dashboard/src/lib/health/alert-history-store.ts`**

```ts
export interface AlertEventRecord {
  eventTime: string
  hostId: number
  hostLabel?: string | null
  rule: string
  severity: 'warning' | 'critical' | 'recovery'
  prevSeverity?: 'warning' | 'critical' | 'recovery' | null
  decisionKind: string
  delivered: boolean
  error?: string | null
  value?: number | null
  channel?: string | null
}

// Best-effort append; wrap the D1 write in try/catch and swallow — MUST NOT throw
// into the sweep. No-op when the D1 binding is unavailable (self-host fail-open).
export async function recordAlertEvent(env, e: AlertEventRecord): Promise<void>

export interface AlertHistoryQuery { hostId?: number; day?: string; limit?: number }
export async function queryAlertEvents(env, q: AlertHistoryQuery): Promise<AlertEventRecord[]>
```
- `id` = `crypto.randomUUID()`; `event_time` from the payload timestamp (fallback `now`).
- `day` filter matches on the `event_time` date prefix (`YYYY-MM-DD`); `limit` defaults to a
  sane cap (e.g. 100/200).

**C. Hook the sweep — `apps/dashboard/src/lib/health/server-sweep.ts`**
Inside the existing `if (decision.notify) { … }` block, **after** the dispatch resolves, call
`recordAlertEvent(env, {…})` with the payload + `decision.kind` + `prev_severity` from the
decision + `delivered`/`error` from the dispatch result + `channel` = the adapter id used. Do
**not** await in a way that lets a failure abort the sweep loop — best-effort, swallow errors.

**D. Read API — new `apps/dashboard/src/routes/api/v1/health/history.ts`**
- Method `GET`. Query params: `hostId?`, `day?` (`YYYY-MM-DD`), `limit?`.
- Returns JSON `{ events: AlertEventRecord[] }` via `queryAlertEvents`.
- Same auth posture as the other `health/*` read routes (`(verify)` — align with
  `health/checks.ts`).

**E. UI card — `health-settings-dialog.tsx`** (`(verify)` filename): a "Recent alerts" card
listing the latest events (time, host, rule, severity, delivered/failed) with an optional
host/day filter, reading `GET /api/v1/health/history`.

## STOP conditions & drift check

- **STOP** if the history write can throw into or slow the sweep — it must be strictly
  best-effort and non-blocking (a failed D1 write must not drop or delay the outbound alert).
- **STOP** if `evaluateAlert` / `server-sweep.ts` no longer exposes the `decision.notify` block
  described above — find the current post-delivery point before hooking.
- **Drift check:** if an `alert_events` table or history store already exists, extend it; match
  the existing D1 binding name rather than inventing one.
- No Postgres; do not touch AI/DDL behaviour.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/health/alert-history-store --isolate
cd apps/dashboard && bun test src/routes/api/v1/health --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

- [ ] `NNNN_alert_events.sql` migration committed (with `host_id`+`event_time` index).
- [ ] `recordAlertEvent` appends a row, never throws into the sweep, no-ops without the D1
  binding (unit tests: success, swallow-on-error, no-op).
- [ ] A dispatched alert produces exactly one `alert_events` row with correct
  `decision_kind` / `prev_severity` / `delivered` / `channel` (sweep-integration test).
- [ ] `GET /api/v1/health/history` filters by `hostId` and `day` and honours `limit`
  (route test).
- [ ] Health settings shows a "Recent alerts" card sourced from the history API.
- [ ] No Postgres. type-check, build, targeted tests, lint all green.

---

Priority P1 · Effort M · Depth F · Wave A (Alerting) · Lever Adoption/Revenue (audit)
