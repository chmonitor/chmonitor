# 28 — Maintenance windows (alert suppression)

## Kickoff prompt

```text
Execute plans/28-maintenance-windows-suppression.md alone (zero prior context).
Goal: suppress health-sweep alerts during planned maintenance (deploys/backups).
Add a D1-backed maintenance_windows store, a CRUD API, a settings UI, and a
suppression check inside the sweep's dispatch loop.
Invariants you MUST hold:
- Self-hosted/OSS stays whole; every plan/billing gate fails OPEN without Clerk
  (missing D1 binding / owner-resolution throw ⇒ degrade to "no windows", never crash).
- AI/alerts RECOMMEND actions but NEVER auto-apply destructive DDL; suppression is
  passive (it only stops a notification) — remediation stays ACK-gated (see plan 29/33).
- Honest paywalls: this feature is free/OSS; do not gate it behind a plan.
- Postgres = NO. D1 only (mirror insights/store/d1-store.ts).
Build ONLY what §"Implement now" lists. Respect STOP conditions. Then run every
command in §Verification and paste the output. Do not touch app features unrelated
to maintenance windows.
```

## Current reality (audited)

**Why (spec):** there is no way to suppress alerts during deploys/backups — a top
alert-fatigue complaint. The autonomous sweep webhooks on every genuinely-new
finding with no notion of "planned work in progress."

File pointers (verified at audit):
- Rules: `apps/dashboard/src/lib/alerting/rule-registry.ts` (`AlertRuleDef`,
  `classifyValue`, `ruleRegistry`) and `.../builtin-rules.ts` (`registerBuiltinRules`).
  *(Note: these live under `lib/alerting/`, not `lib/health/`.)*
- Dedup/decision: `apps/dashboard/src/lib/health/alert-state-store.ts`
  (`evaluateAlert`, `decideNotification`, `AlertDecisionKind`).
- Sweep + dispatch loop: `apps/dashboard/src/lib/health/server-sweep.ts`
  (`runHealthSweep`; the dispatch block is the `if (canDispatch) { … evaluateAlert …
  if (decision.notify) { postWebhook(...) } }` section, ~L242–268).
- Cron entry: `apps/dashboard/src/routes/api/cron/health-sweep.ts` (`GET`,
  `CRON_SECRET` fail-closed → 503).
- Adapters: `apps/dashboard/src/lib/health/adapters/*` (+ `index.ts`,
  `detectAdapter`). `AlertPayload` in `adapters/types.ts`.
- D1 pattern to mirror: `apps/dashboard/src/lib/insights/store/d1-store.ts`
  (bindings `['INSIGHTS_D1','CHM_CLOUD_D1']` via `getPlatformBindings()`, lazy
  `CREATE TABLE IF NOT EXISTS`, single-flight migration, **swallow all failures**).
- Migrations dir: `apps/dashboard/src/db/conversations-migrations/NNNN_*.sql`
  (highest existing = `0006_auth_identities.sql`; add the next number).
- Suppression must be recorded in the alert history log from plan 27
  (`alert_events`, `alert-history-store.ts`) — **soft dependency**: if plan 27 is
  not yet merged, log the suppression via `debug()` and leave a `TODO(27)` hook.

## Goal

An operator can declare a maintenance window (one host or all hosts, with
start/end + reason); while `now` is inside a window that targets a finding's host,
the sweep **suppresses the notification** (records decision kind `maintenance`),
still runs the rule and reports the finding in the summary, and — when plan 27 is
present — writes a `maintenance`-kind row to the alert history. Windows are managed
via a CRUD API + a settings dialog. Fails open (no D1 ⇒ no windows ⇒ normal behavior).

## Implement now

### D1 — new migration `src/db/conversations-migrations/0007_maintenance_windows.sql`
```sql
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id         TEXT    NOT NULL PRIMARY KEY,   -- uuid
  owner_id   TEXT    NOT NULL,               -- billing-owner id (Clerk user_*/org_*); '' for OSS single-tenant
  host_id    INTEGER,                        -- NULL ⇒ applies to ALL hosts
  reason     TEXT    NOT NULL DEFAULT '',
  starts_at  INTEGER NOT NULL,               -- unix ms
  ends_at    INTEGER NOT NULL,               -- unix ms
  created_by TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maint_windows_active
  ON maintenance_windows (owner_id, ends_at);
```

### Store — `src/lib/health/maintenance-windows.ts` (mirror insights d1-store)
- Bindings order `['MAINTENANCE_D1','CHM_CLOUD_D1']`; lazy migrate; single-flight;
  swallow+log failures (fail-open).
- `interface MaintenanceWindow { id; ownerId; hostId: number|null; reason; startsAt; endsAt; createdBy; createdAt }`.
- `listWindows(ownerId): Promise<MaintenanceWindow[]>`
- `createWindow(input): Promise<MaintenanceWindow>` (generate uuid; validate `endsAt > startsAt`)
- `deleteWindow(ownerId, id): Promise<void>` (owner-scoped WHERE)
- **Pure, unit-testable core** `isSuppressed(windows, hostId, now): boolean` —
  true iff any window matches (`hostId === null || w.hostId === hostId`) AND
  `w.startsAt <= now < w.endsAt`. Export this separately for tests (no D1 needed).
- Optional 30s in-memory cache of active windows keyed by owner to avoid a D1 read
  every sweep tick (mirror the table-existence cache pattern).

### Route — `src/routes/api/v1/health/maint-windows.ts` (TanStack `createFileRoute`)
- Follow the existing `createFileRoute('/api/v1/health/…')({ server:{ handlers:{…} } })`
  shape (see `health-sweep.ts` for the pattern).
- `GET` → `listWindows(owner)`; `POST` (create, validate body with the store's zod/parse);
  `DELETE ?id=` (delete). Resolve owner via the existing billing-owner helper used by
  other `/api/v1/*` routes; **wrap owner resolution in try/catch → treat as OSS single
  tenant (`ownerId=''`)** so it fails open without Clerk. Auth-gate writes like other
  mutating health routes.

### Sweep hook — `src/lib/health/server-sweep.ts`
- Before the per-host loop, load `const windows = await listWindows(ownerForSweep)`
  once (best-effort; on throw ⇒ `[]`). *(Sweep is currently owner-agnostic; resolve
  the sweep's owner the same way the cron route resolves ClickHouse configs, or pass
  `''` for OSS — `(verify)` the exact owner source and keep fail-open.)*
- Inside the dispatch block, **after** `evaluateAlert(...)` returns `decision.notify`
  === true but **before** `postWebhook(...)`, insert:
  ```ts
  if (decision.notify && isSuppressed(windows, config.id, Date.now())) {
    alertsSuppressed++                 // reuse existing counter
    // TODO(27): historyStore.record({ ..., decisionKind: 'maintenance', delivered: false })
    continue                            // skip postWebhook
  }
  ```
  Do NOT mutate the dedup state store differently — suppression must not reset the
  cooldown (the condition is still "known firing"; `evaluateAlert` already persisted
  the record). Add a `maintenanceSuppressed` field to `SweepSummary` for observability.

### UI — `src/components/health/maintenance-windows-dialog.tsx` `(verify dir)`
- No `components/health/` dir was found at audit — locate where the existing health
  settings dialog lives (grep `health-settings` / the /health route) and colocate.
- List active + upcoming windows; create form (host picker incl. "All hosts", reason,
  start, end); delete button. Use existing dialog/table primitives + TanStack Query.

### History integration (soft dep on plan 27)
- If `alert-history-store.ts` exists, record suppressed events with
  `decisionKind:'maintenance'`, `delivered:false`. Otherwise leave the `TODO(27)` hook.

## STOP conditions & drift check
- If **no D1 binding** resolves at runtime, the store must degrade to "no windows"
  (empty list) — never throw into the sweep or the route. Verify by unit-testing
  `isSuppressed` with a hand-built array (no D1) and by confirming the store
  swallows a null-binding.
- Do **not** add a new webhook/transport, new adapter, or any auto-remediation here.
- Do **not** change dedup semantics (`decideNotification`) — suppression is a gate
  layered *after* the decision, not a new decision kind inside the pure transition.
- If the sweep's owner cannot be resolved cleanly, ship with `ownerId=''` (OSS
  single-tenant) and mark the multi-tenant owner wiring `(verify)` — do not block.
- If `components/health/` truly doesn't exist, colocate the dialog with the found
  health settings component; don't invent a new top-level route.

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/health/maintenance-windows.test.ts --isolate
cd apps/dashboard && bun test src/lib/health/ --isolate
cd apps/dashboard && bun run lint
```

## Done criteria
- `0007_maintenance_windows.sql` migration added; store + pure `isSuppressed` shipped
  with tests covering in-window / out-of-window / all-hosts / per-host.
- CRUD route returns owner-scoped windows; create validates `endsAt > startsAt`;
  writes auth-gated; owner resolution fails open (OSS ⇒ `ownerId=''`).
- Sweep suppresses matching alerts inside a window (increments a suppressed counter,
  skips `postWebhook`), still reports the finding, does not reset cooldown.
- Suppressed events recorded to `alert_events` when plan 27 present (else `TODO(27)`).
- Settings dialog can create/list/delete windows.
- All four verification commands pass.

Priority: P1 · Effort: M · Depth: F · Wave: A (Alerting) · Lever: Adoption
