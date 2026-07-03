# 29 — Alert ACK / manual resolution (snooze)

## Kickoff prompt

```text
Execute plans/29-alert-ack-manual-resolution.md alone (zero prior context).
Goal: let an operator ACK/snooze a firing alert so it stops re-dispatching for a
chosen duration, without waiting for the condition to clear. Add a D1 alert_acks
store, a POST /ack route, a suppression check in the sweep, and an Active Alerts panel.
Invariants you MUST hold:
- Self-hosted/OSS stays whole; every gate fails OPEN without Clerk (no D1 binding /
  owner-resolution throw ⇒ degrade to "no acks", never crash the sweep or route).
- AI/alerts RECOMMEND but NEVER auto-apply destructive DDL. An ACK only suppresses a
  NOTIFICATION for a bounded window — it performs no cluster action; remediation stays
  ACK-gated (see plan 33).
- Honest paywalls: ACK/snooze is free/OSS; do not gate behind a plan.
- Postgres = NO. D1 only (mirror insights/store/d1-store.ts).
Build ONLY §"Implement now". Respect STOP conditions. Then run every command in
§Verification and paste output.
```

## Current reality (audited)

**Why (spec):** an operator can't ACK/snooze a firing alert; it only stops when the
condition itself clears. Persistent-but-known incidents keep hitting the cooldown
`reminder` path forever.

File pointers (verified):
- Dedup engine: `apps/dashboard/src/lib/health/alert-state-store.ts` —
  `evaluateAlert(store, {hostId, ruleId, severity, cooldownMs, now})` returns an
  `AlertDecision { notify, kind, severity, previousSeverity }`. `decideNotification`
  is the pure transition; `MemoryAlertStateStore` is the process singleton.
- Sweep dispatch loop: `apps/dashboard/src/lib/health/server-sweep.ts` — the
  `if (canDispatch) { … const decision = evaluateAlert(...) ; if (decision.notify) {
  postWebhook(...) } }` block (~L242–268). `alertsSuppressed` counter already exists.
- Rules: `apps/dashboard/src/lib/alerting/rule-registry.ts` (`AlertRuleDef.id/title`),
  `.../builtin-rules.ts`. Condition identity is `hostId:ruleId` (see `alertStateKey`).
- Cron entry: `apps/dashboard/src/routes/api/cron/health-sweep.ts`.
- Adapters: `apps/dashboard/src/lib/health/adapters/*`.
- D1 pattern: `apps/dashboard/src/lib/insights/store/d1-store.ts` (bindings
  `['INSIGHTS_D1','CHM_CLOUD_D1']`, lazy `CREATE TABLE IF NOT EXISTS`, swallow failures).
- Migrations: `src/db/conversations-migrations/NNNN_*.sql` (next after `0006`).
- The Active Alerts panel needs the current firing set — the sweep already builds
  `SweepSummary.findings`; expose the latest sweep (or re-derive) for the panel. If a
  live "current findings" API doesn't exist, add a thin read (`(verify)`).

## Goal

An ACK on a `(hostId, ruleId)` condition suppresses dispatch for a chosen duration
(5 / 15 / 60 / 240 minutes), recording who ACKed and when. The sweep, when about to
notify, checks for an active ACK and suppresses (kind `acked`) instead of posting. An
**Active Alerts** panel lists currently-firing conditions with ACK controls and shows
ACK state (actor + expiry). Fails open (no D1 ⇒ ACK is a no-op, alerts behave as today).

## Implement now

### D1 — new migration `src/db/conversations-migrations/0008_alert_acks.sql`
```sql
CREATE TABLE IF NOT EXISTS alert_acks (
  owner_id    TEXT    NOT NULL,   -- billing-owner id; '' for OSS single-tenant
  host_id     INTEGER NOT NULL,
  rule_id     TEXT    NOT NULL,
  acked_by    TEXT    NOT NULL DEFAULT '',
  acked_at    INTEGER NOT NULL,   -- unix ms
  expires_at  INTEGER NOT NULL,   -- unix ms; suppress while now < expires_at
  note        TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (owner_id, host_id, rule_id)   -- one active ack per condition; re-ACK upserts
);
CREATE INDEX IF NOT EXISTS idx_alert_acks_expiry ON alert_acks (owner_id, expires_at);
```
*(Use `0008` if plan 28 took `0007`; otherwise `0007`. Pick the next free number.)*

### Store — `src/lib/health/alert-ack-store.ts` (mirror insights d1-store)
- `ACK_DURATIONS_MS = { '5m':300000, '15m':900000, '60m':3_600_000, '240m':14_400_000 }`.
- `interface AlertAck { ownerId; hostId; ruleId; ackedBy; ackedAt; expiresAt; note }`.
- `ackAlert({ownerId, hostId, ruleId, durationKey, ackedBy, note, now?}): Promise<AlertAck>`
  — upsert (`INSERT … ON CONFLICT(owner_id,host_id,rule_id) DO UPDATE`).
- `listActiveAcks(ownerId, now?): Promise<AlertAck[]>` — `WHERE expires_at > now`.
- `clearAck(ownerId, hostId, ruleId): Promise<void>` (manual un-ACK).
- **Pure core** `isAcked(acks: AlertAck[], hostId, ruleId, now): boolean` — export
  separately for tests (no D1). Optional ~15–30s in-memory cache keyed by owner.
- Every D1 failure swallowed+logged ⇒ `isAcked` sees `[]` ⇒ fail-open.

### Route — `src/routes/api/v1/health/ack.ts` (TanStack `createFileRoute`)
- `POST` body `{ hostId:number, ruleId:string, duration:'5m'|'15m'|'60m'|'240m',
  note?:string }` → `ackAlert(...)`, `ackedBy` from the session user (best-effort).
- `GET` → `listActiveAcks(owner)` (feeds the panel).
- `DELETE ?hostId=&ruleId=` → `clearAck`.
- Owner + user resolution wrapped in try/catch → OSS single-tenant (`ownerId=''`,
  `ackedBy='operator'`); auth-gate writes like other mutating health routes.

### Sweep hook — `src/lib/health/server-sweep.ts`
- Load `const acks = await listActiveAcks(ownerForSweep)` once before the host loop
  (best-effort ⇒ `[]` on throw). Owner source `(verify)` — `''` for OSS is acceptable.
- In the dispatch block, after `evaluateAlert(...)` yields `decision.notify === true`
  and after the plan-28 maintenance check (if present), add:
  ```ts
  if (decision.notify && isAcked(acks, config.id, rule.id, Date.now())) {
    alertsSuppressed++
    // TODO(27): historyStore.record({ ..., decisionKind: 'acked', delivered: false })
    continue                            // skip postWebhook
  }
  ```
  Do NOT alter `decideNotification` or reset the cooldown — the dedup record was
  already persisted by `evaluateAlert`; ACK is a post-decision dispatch gate.
- Add `ackedSuppressed` to `SweepSummary` for observability.
- **Recovery override:** if `decision.kind === 'recovery'`, do NOT suppress (an
  operator should always learn a condition resolved) and clear any active ACK for
  that `(hostId, ruleId)` via `clearAck(...)` (best-effort).

### UI — `src/components/health/active-alerts-panel.tsx` `(verify dir)`
- `components/health/` was not found at audit — colocate with the existing health
  settings component (grep `health-settings`). Panel lists currently-firing
  conditions from the latest `SweepSummary.findings` (or a thin "current findings"
  read), each with an "Acknowledge" control (duration dropdown) → `POST /ack`, and
  shows active-ACK state (who / expires in) from `GET /ack`. TanStack Query for
  fetch + invalidation on ACK.

### History integration (soft dep on plan 27)
- If `alert-history-store.ts` exists, record ACK-suppressed events with
  `decisionKind:'acked'`, `delivered:false`; else `TODO(27)` hook.

## STOP conditions & drift check
- No D1 binding ⇒ ACK store is a no-op; `isAcked` returns false everywhere; sweep +
  route never throw. Prove with a pure `isAcked` unit test (hand-built array).
- ACK suppresses **notifications only**. It must not run any query or cluster action
  (no auto-remediation — invariant).
- Never suppress a `recovery`; clear the ACK on recovery.
- Do not change dedup transition logic or cooldown reset behavior.
- Duration is whitelisted to the four values; reject others with 400.
- If owner/user can't resolve, ship OSS single-tenant (`ownerId=''`) and mark
  multi-tenant wiring `(verify)`; don't block.

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/health/alert-ack-store.test.ts --isolate
cd apps/dashboard && bun test src/lib/health/ --isolate
cd apps/dashboard && bun run lint
```

## Done criteria
- Migration + `alert-ack-store.ts` (with pure `isAcked`) shipped; tests cover
  active / expired / wrong-condition / re-ACK upsert.
- `POST /api/v1/health/ack` records actor + expiry; `GET` lists active; `DELETE`
  clears; duration whitelist enforced; owner resolution fails open.
- Sweep suppresses dispatch while an ACK is active (skips `postWebhook`, increments a
  suppressed counter), never suppresses recovery, and clears ACK on recovery.
- Active Alerts panel shows firing conditions + ACK state and can ACK/snooze.
- All four verification commands pass.

Priority: P1 · Effort: M · Depth: F · Wave: A (Alerting) · Lever: Adoption
