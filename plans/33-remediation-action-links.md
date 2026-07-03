# 33 — Remediation action links (runbook + read-only actions)

## Kickoff prompt

```text
Execute plans/33-remediation-action-links.md alone (zero prior context).
Goal: give alerts a runbook/action affordance to cut MTTR — labeled runbook links
and a SMALL set of READ-ONLY diagnostic actions, surfaced as Slack buttons/links and
executable via an auth-gated endpoint. Rules declare their own actions.
Invariants you MUST hold (this plan is where they bite hardest):
- AI/alerts RECOMMEND actions but NEVER auto-apply destructive DDL. The action
  endpoint runs ONLY read-only SQL (readonly=1) or records intent; it NEVER executes
  ALTER/DROP/mutations. Any state-changing remediation stays ACK-gated and manual.
- Self-hosted/OSS stays whole; the endpoint fails OPEN without Clerk BUT still
  requires the same auth the other mutating health routes require (a read-only query
  is still a cluster call — auth-gate it).
- Honest paywalls: action links are free/OSS; do not gate behind a plan.
- Postgres = NO.
Build ONLY §"Implement now". Respect STOP conditions. Then run every command in
§Verification and paste output.
```

## Current reality (audited)

**Why (spec):** alerts carry no runbook/action affordance, so MTTR suffers. Advisor
auto-exec is explicitly out of scope (invariant). Today an alert is a one-line text
webhook with, at most, runbook URLs rendered by the Slack adapter.

File pointers (verified):
- Rule shape: `apps/dashboard/src/lib/alerting/rule-registry.ts` — `AlertRuleDef`
  currently has `{ id, type, title, description, sql?, valueKey, defaults,
  formatLabel?, optional?, tableCheck? }`. **No `remediationActions` field yet.**
  Built-ins in `.../builtin-rules.ts` (`registerBuiltinRules`).
- Slack adapter: `apps/dashboard/src/lib/health/adapters/slack.ts` — `buildSlackBody`
  emits Block Kit blocks; it already renders a `*Runbooks:*` section from
  `payload.runbookUrls`. `AlertPayload` (with `runbookUrls?`) in `adapters/types.ts`.
  Registry + `detectAdapter` in `adapters/index.ts`.
- Sweep: `apps/dashboard/src/lib/health/server-sweep.ts` posts a plain
  `{ text, content }` webhook via `postWebhook`; it does NOT currently build an
  `AlertPayload` per finding (`(verify)` — the richer adapters exist as a pure layer
  but the sweep still posts flat text). Wiring the sweep to `buildSlackBody` is a
  prerequisite for buttons to appear from cron; if that's too broad, ship the
  action-declaration + endpoint and render buttons where the adapter payload is
  already used, marking the sweep wiring `(verify)`.
- Cron entry: `apps/dashboard/src/routes/api/cron/health-sweep.ts`.
- SSRF-guarded read path: rules run via `fetchData({ …, clickhouse_settings:{ readonly:'1' } })`
  (see `runRuleQuery` in server-sweep). Reuse that read-only transport.
- D1 pattern (for recording action intent): `insights/store/d1-store.ts`.

## Goal

Rules can declare labeled `remediationActions` (a runbook link, or a read-only
"get diagnostics" query). Adapters render them (Slack action buttons for executable
actions, link sections for runbooks). An auth-gated `POST /api/v1/health/actions`
executes a **whitelisted read-only** action for a `(hostId, ruleId, actionId)` and
returns its result (or records intent) — and **never** runs destructive DDL.

## Implement now

### Rule schema — `src/lib/alerting/rule-registry.ts`
Add an optional field to `AlertRuleDef`:
```ts
export type RemediationActionKind = 'runbook' | 'diagnostic'
export interface RemediationAction {
  id: string                 // stable, unique within the rule (e.g. 'top-mutations')
  label: string              // button/link text
  kind: RemediationActionKind
  url?: string               // required when kind==='runbook'
  sql?: string               // required when kind==='diagnostic'; MUST be read-only SELECT
  description?: string
}
// on AlertRuleDef:
remediationActions?: RemediationAction[]
```
- Add a pure validator `assertReadOnlyAction(a: RemediationAction)` in this file (or a
  sibling) that rejects a `diagnostic` whose `sql` matches a deny-list
  (`/\b(ALTER|DROP|DELETE|INSERT|UPDATE|TRUNCATE|OPTIMIZE|ATTACH|DETACH|CREATE|RENAME|GRANT|REVOKE|SYSTEM)\b/i`)
  or lacks a leading `SELECT`/`SHOW`/`EXPLAIN`/`DESCRIBE`. Unit-test it.

### Declare actions on a few built-ins — `src/lib/alerting/builtin-rules.ts`
- Add `remediationActions` to ~4 high-value rules, each with a `runbook` link and one
  `diagnostic` read-only query, e.g.:
  - `failed-mutations` → diagnostic `SELECT * FROM system.mutations WHERE is_done=0 …`
  - `stuck-merges` → diagnostic `SELECT * FROM system.merges ORDER BY elapsed DESC …`
  - `replication-lag` → diagnostic `SELECT * FROM system.replicas WHERE … ORDER BY absolute_delay DESC`
  - `disk-usage` → runbook link only (TTL/partition guidance) — no destructive action.
- Every diagnostic SQL must pass `assertReadOnlyAction`.

### Adapter payload — `src/lib/health/adapters/types.ts` + `adapters/slack.ts`
- Extend `AlertPayload` with `actions?: readonly { id; label; kind; url? }[]`
  (channel-agnostic; omit raw SQL from the payload — the button carries only ids).
- In `buildSlackBody`, when `payload.actions?.length`, append an `actions` block:
  runbook actions → Block Kit `button` with `url` (link-out, no interaction round-trip);
  diagnostic actions → `button` with `action_id: "chm_action:<ruleId>:<actionId>"` and
  a `value` carrying `{hostId, ruleId, actionId}` (the interaction handler / native
  Slack app in plan 37 will POST it; for non-Slack-app installs, render diagnostics as
  a labeled link to the in-app Active Alerts panel instead of an interactive button).
- Keep the existing `*Runbooks:*` `runbookUrls` section for back-compat.

### Execute endpoint — `src/routes/api/v1/health/actions.ts` (TanStack `createFileRoute`)
- `POST` body `{ hostId:number, ruleId:string, actionId:string }`.
- Resolve the rule from `ruleRegistry.get(ruleId)`; find the action by `actionId`;
  if `kind==='runbook'` return `{ url }` (nothing to execute). If `kind==='diagnostic'`:
  re-run `assertReadOnlyAction`, then execute via the read-only transport
  `fetchData({ query: action.sql, hostId, format:'JSONEachRow',
  clickhouse_settings:{ readonly:'1' } })` and return the rows (capped, e.g. first 50).
- **Auth-gate** exactly like the other mutating health routes (this hits the cluster).
  Owner resolution fails open (OSS ⇒ proceed), but the auth gate stays. Record the
  action invocation (best-effort) to the alert history (plan 27) or via `debug()`.
- Return 400 for unknown rule/action; 422 if `assertReadOnlyAction` rejects (defense
  in depth even though declaration-time validation should have caught it).

### (Optional) intent log
- If `alert-history-store.ts` (plan 27) exists, record `{ decisionKind:'action',
  ruleId, actionId, hostId, actor, result:'ok'|'error' }`. Otherwise `TODO(27)`.

## STOP conditions & drift check
- The endpoint runs **read-only SQL only** (`readonly=1`) or returns a runbook URL. If
  you find yourself wanting to run `ALTER`/`OPTIMIZE`/a mutation to "fix" the alert —
  STOP. That is the exact invariant this plan protects; remediation stays manual/ACK-
  gated. No DDL execution, ever.
- `assertReadOnlyAction` must run at BOTH declaration time (rule registration/test) and
  request time (endpoint). Do not trust the client-supplied `actionId` to carry SQL —
  the SQL is looked up server-side from the rule, never taken from the request body.
- Do not remove the existing `runbookUrls` rendering (back-compat).
- If the sweep doesn't yet build `AlertPayload` per finding, ship the schema + endpoint
  + adapter support and mark the sweep→adapter wiring `(verify)`; don't rewrite the
  whole sweep dispatch path in this plan.
- Keep the action set tiny and diagnostic; this is affordance, not automation.

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/health/adapters/ --isolate
cd apps/dashboard && bun test src/lib/alerting/ --isolate
cd apps/dashboard && bun run lint
```

## Done criteria
- `AlertRuleDef.remediationActions` + `RemediationAction` type shipped; `assertReadOnlyAction`
  validator with unit tests (accepts SELECT/SHOW/EXPLAIN, rejects ALTER/DROP/mutations/SYSTEM).
- ≥4 built-in rules declare a runbook link and/or a read-only diagnostic action.
- Slack adapter renders action buttons/links; `runbookUrls` section preserved.
- `POST /api/v1/health/actions` executes only whitelisted read-only SQL (server-looked-up),
  auth-gated, capped output; rejects unknown/destructive with 400/422; no DDL auto-exec.
- Action invocations recorded when plan 27 present (else `TODO(27)`).
- All four verification commands pass.

Priority: P2 · Effort: M · Depth: F · Wave: A (Alerting) · Lever: Adoption
