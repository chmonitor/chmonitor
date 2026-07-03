# Plan 06: Persist alert dedup state only after the webhook delivery succeeds

> **Executor instructions**: Follow step by step, running each verification
> command and confirming its expected result before moving on. If a "STOP
> condition" occurs, stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat c5b2ae41c..HEAD -- apps/dashboard/src/lib/health/alert-state-store.ts apps/dashboard/src/lib/health/server-sweep.ts apps/dashboard/src/lib/health/alert-state-store.test.ts`
> On any change, compare "Current state" against live code; mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `c5b2ae41c`, 2026-07-03

## Why this matters

The autonomous health sweep (cron, every ~5 min) records an alert as "notified"
**before** it confirms the webhook actually delivered. `evaluateAlert` persists the
dedup record (`notifiedAt = now`) as a side effect of *deciding*
(`alert-state-store.ts:248-253`), and the sweep only then calls `postWebhook`
(`server-sweep.ts:245-263`) — whose `false` return (Slack/Discord 5xx, timeout, network
error) bumps no counter and rolls nothing back. So when a **new** or **escalated** critical
alert's first delivery fails, the store already says "notified now", and the next sweep
sees the same severity within the cooldown (`DEFAULT_ALERT_COOLDOWN_MS`, ~60 min) and
**suppresses** it. A critical alert whose first POST fails is silently dropped for up to
an hour — and lost entirely if the condition drops below threshold in the meantime. The
fix commits the "notified" timestamp only after a confirmed delivery, so a failed send is
retried on the next sweep.

## Current state

Files:
- `apps/dashboard/src/lib/health/alert-state-store.ts` — `MemoryAlertStateStore` (`:86`), the module singleton `alertStateStore` (`:107`), `decideNotification` (pure decider, returns `{ decision, next }`), and `evaluateAlert` (`:232-254`) which reads → decides → **persists** → returns only the decision.
- `apps/dashboard/src/lib/health/server-sweep.ts` — the sweep loop; the only non-test caller of `evaluateAlert` (`:245`).
- `apps/dashboard/src/lib/health/alert-state-store.test.ts` — existing tests; `describe('evaluateAlert + MemoryAlertStateStore')` (`:115`) constructs `new MemoryAlertStateStore()` and reads `evaluateAlert(store, {...}).kind`.

`evaluateAlert` today (`alert-state-store.ts:232-254`) — note it persists unconditionally:

```ts
export function evaluateAlert(store, params): AlertDecision {
  const key = alertStateKey(params.hostId, params.ruleId)
  const prev = store.get(key)
  const { decision, next } = decideNotification(prev, params.severity, {
    cooldownMs: params.cooldownMs, now: params.now,
  })
  if (next === null) store.delete(key)
  else store.set(key, next)          // ⚠ persists notifiedAt=now BEFORE delivery
  return decision
}
```

The sweep today (`server-sweep.ts:242-267`) — delivery failure changes nothing:

```ts
const decision = evaluateAlert(alertStateStore, { hostId: config.id, ruleId: rule.id, severity: effective, cooldownMs })
if (decision.notify) {
  const text = decision.kind === 'recovery' ? `[RECOVERY] …` : `[${effective.toUpperCase()}] …`
  const ok = await postWebhook(settings.webhookUrl, text)
  if (ok) { alertsDispatched++; if (decision.kind === 'recovery') recoveries++ }
  // ⚠ ok === false → nothing rolls back; state already says "notified"
} else if (SEVERITY_ORDER[severity] >= minRank) {
  alertsSuppressed++
}
```

Convention: keep `decideNotification` **pure** and unchanged — it already returns the
correct `next` record (with `notifiedAt`); only *when* that record is persisted changes.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `cd apps/dashboard && bun run type-check` | exit 0 |
| Unit test | `cd apps/dashboard && bun test src/lib/health/alert-state-store.test.ts --isolate` | all pass |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `apps/dashboard/src/lib/health/alert-state-store.ts`
- `apps/dashboard/src/lib/health/server-sweep.ts`
- `apps/dashboard/src/lib/health/alert-state-store.test.ts`

**Out of scope**:
- `decideNotification` and the `AlertDecision`/`AlertStateRecord` types — do not change the decision logic or record shape, only the persistence timing.
- The cooldown value, severity ordering, recovery logic.
- Any other consumer of the alert system.

## Git workflow

- Branch: `advisor/06-alert-commit-after-delivery`
- Conventional commits + `Co-Authored-By: duyetbot <bot@duyet.net>`. Example: `fix(alerting): commit dedup state only after webhook delivery to stop dropped alerts`.
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Make `evaluateAlert` return a deferred `commit`, not persist eagerly

Change `evaluateAlert` so it computes the decision + pending record but does **not** write;
it returns a `commit` thunk the caller invokes when it wants the state to land:

```ts
export function evaluateAlert(
  store: AlertStateStore,
  params: { hostId: number; ruleId: string; severity: AlertRuleSeverity; cooldownMs?: number; now?: number },
): { decision: AlertDecision; commit: () => void } {
  const key = alertStateKey(params.hostId, params.ruleId)
  const prev = store.get(key)
  const { decision, next } = decideNotification(prev, params.severity, {
    cooldownMs: params.cooldownMs, now: params.now,
  })
  const commit = () => { if (next === null) store.delete(key); else store.set(key, next) }
  return { decision, commit }
}
```

**Verify**: `cd apps/dashboard && bun run type-check` → will FAIL until Step 2 + Step 3 update the caller and tests. That's expected; proceed.

### Step 2: In the sweep, commit only after a successful delivery

Restructure the `server-sweep.ts` dispatch block (`:245-267`):

```ts
const { decision, commit } = evaluateAlert(alertStateStore, {
  hostId: config.id, ruleId: rule.id, severity: effective, cooldownMs,
})
if (decision.notify) {
  const label = rule.formatLabel ? rule.formatLabel(value) : String(value)
  const text = decision.kind === 'recovery'
    ? `[RECOVERY] ${rule.title} — resolved (host ${name})`
    : `[${effective.toUpperCase()}] ${rule.title} — ${label} (host ${name})`
  const ok = await postWebhook(settings.webhookUrl, text)
  if (ok) {
    commit()                            // persist notifiedAt ONLY after confirmed delivery
    alertsDispatched++
    if (decision.kind === 'recovery') recoveries++
  }
  // ok === false → do NOT commit → next sweep re-evaluates and retries
} else {
  commit()                              // record dedup/de-escalation/recovery-cleared bookkeeping
  if (SEVERITY_ORDER[severity] >= minRank) alertsSuppressed++
}
```

Note: `commit()` moves into the `else` branch too (every non-notify decision still records
its state — only the *notify* path gates on delivery).

**Verify**: `cd apps/dashboard && bun run type-check` → exit 0 (proves caller updated).

### Step 3: Update existing tests to the new return shape and add the regression test

In `alert-state-store.test.ts`, every existing `evaluateAlert(store, {...})` now returns
`{ decision, commit }`. Mechanically: capture the result, read `.decision.kind` /
`.decision.notify` instead of `.kind` / `.notify`, and call `.commit()` **immediately after
each existing call** so the prior "always-persisted" behaviour (which the cooldown
assertions depend on) is reproduced exactly.

Then add the regression test in the same `describe`:

```ts
test('a failed delivery (no commit) does not suppress the next sweep', () => {
  const store = new MemoryAlertStateStore()
  const base = { hostId: 1, ruleId: 'cpu', cooldownMs: 60_000 }
  const first = evaluateAlert(store, { ...base, severity: 'critical', now: 1_000 })
  expect(first.decision.notify).toBe(true)          // new critical → notify
  // simulate delivery FAILURE: do NOT commit
  const second = evaluateAlert(store, { ...base, severity: 'critical', now: 2_000 })
  expect(second.decision.notify).toBe(true)         // retried, NOT suppressed
  second.commit()                                   // delivery now succeeds
  const third = evaluateAlert(store, { ...base, severity: 'critical', now: 3_000 })
  expect(third.decision.notify).toBe(false)         // within cooldown after a committed notify → suppressed
})
```

**Verify**: `cd apps/dashboard && bun test src/lib/health/alert-state-store.test.ts --isolate` → all pass; `bun run lint` → exit 0.

## Test plan

- Update all existing `evaluateAlert` usages in `alert-state-store.test.ts` to `.decision` + `.commit()`.
- Add the "failed delivery does not suppress next sweep" regression test (above) — it fails on the current code (which suppresses) and passes after the fix.
- Structural pattern: the existing `describe('evaluateAlert + MemoryAlertStateStore')` block.
- Verification: `cd apps/dashboard && bun test src/lib/health/alert-state-store.test.ts --isolate` → all pass.

## Done criteria

- [ ] `evaluateAlert` returns `{ decision, commit }` and performs no store write itself
- [ ] `server-sweep.ts` calls `commit()` inside `if (ok)` for the notify path and in the non-notify `else`
- [ ] `cd apps/dashboard && bun test src/lib/health/alert-state-store.test.ts --isolate` passes, incl. the new regression test
- [ ] `cd apps/dashboard && bun run type-check` exits 0
- [ ] `cd apps/dashboard && bun run build` exits 0
- [ ] `bun run lint` exits 0
- [ ] No files outside scope modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- `rg -n "evaluateAlert" apps/dashboard/src` reveals a **non-test caller other than `server-sweep.ts`** — update it too, but if its shape is unclear, STOP and report.
- `decideNotification` does not already return a `next` record containing `notifiedAt` (drift from the excerpt).
- After the change, an existing cooldown/reminder test fails for a reason other than the mechanical `.decision` / `.commit()` update.

## Maintenance notes

- Reviewer: confirm `commit()` is unreachable on the `postWebhook` failure path for a notify decision, and reachable on every non-notify path.
- `alertStateStore` is a warm module singleton — the retry is per-process; a cold start still worst-cases to one duplicate (documented at `alert-state-store.ts:20-22`). This fix does not change that trade-off.
- If delivery is ever made to fan out to multiple channels, "success" for commit should mean "all required channels delivered" (or per-channel commit) — revisit then.
