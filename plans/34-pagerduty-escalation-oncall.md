# 34 — PagerDuty escalation & on-call routing

## Kickoff prompt

```text
Execute plans/34-pagerduty-escalation-oncall.md alone (zero prior context). This is an
EPIC brief — do light discovery first, then build.
Goal: route alerts to specific PagerDuty SERVICES (per rule/host) so PagerDuty's own
escalation policies + on-call schedules take over, with one incident per (host,rule)
via a stable dedup key. Today the PagerDuty adapter posts a single event and ignores
service/escalation routing.
Invariants you MUST hold:
- Self-hosted/OSS stays whole; fail OPEN without Clerk (no D1 / owner throw ⇒ fall back
  to the single env routing key / legacy behavior; never crash the sweep).
- AI/alerts RECOMMEND but NEVER auto-apply destructive DDL; routing to PagerDuty only
  pages a human — remediation stays ACK-gated (plans 29/33). PagerDuty owns escalation;
  chmonitor does NOT auto-run any fix.
- Honest paywalls: if per-service routing is advertised as paid, gate via
  lib/billing/plan-enforcement.ts (enforced|deferred honestly); else ship free.
- Postgres = NO. D1 only (mirror insights/store/d1-store.ts).
Build ONLY §"Implement now". Respect STOP conditions. Then run every command in
§Verification and paste output.
```

## Current reality (audited)

**Why (spec):** the PagerDuty adapter posts events but ignores escalation policies /
on-call routing. Every alert goes to one integration key regardless of rule or host.

File pointers (verified):
- PagerDuty adapter: `apps/dashboard/src/lib/health/adapters/pagerduty.ts` — Events API
  v2 enqueue (`https://events.pagerduty.com/v2/enqueue`); `buildPagerDutyBody(payload,
  { routingKey })`; `pagerDutyDedupKey(payload) = 'chmonitor:' + hostId + ':' + metric`;
  `recovery → event_action:'resolve'`. The exported `pagerDutyAdapter.buildBody` uses a
  `'<routing_key>'` placeholder — **the dispatch layer substitutes the real key**.
- Adapters registry + `detectAdapter` (`events.pagerduty.com`): `adapters/index.ts`.
- Sweep + dispatch: `apps/dashboard/src/lib/health/server-sweep.ts` (`runHealthSweep`,
  `postWebhook`, `evaluateAlert` dedup key `hostId:ruleId`).
- Config: `apps/dashboard/src/lib/health/server-alert-config.ts` (`HEALTH_ALERT_*`).
- D1 pattern: `insights/store/d1-store.ts`. Migrations:
  `src/db/conversations-migrations/NNNN_*.sql` (next after `0006`).
- **Depends on plan 30 (per-rule routing):** this plan EXTENDS `alert-routing.ts` /
  `alert_routes` to carry a PagerDuty service target. If plan 30 is not yet merged, build
  the minimal routing table here and note the merge overlap `(verify)`.
- Health UI dir `(verify)` — colocate the setup dialog with the health-settings component.

## Goal

An operator maps rule/host patterns → a PagerDuty **service** (its integration/routing
key). When a matching finding notifies, the sweep enqueues a PagerDuty `trigger` (or
`resolve` on recovery) to that service's routing key, letting PagerDuty apply the
service's escalation policy + on-call schedule. Dedup ensures **one open incident per
(host, rule)**; a stale env key remains a fallback so existing setups keep working.

## Implement now (approach + key files)

- **Config module** `src/lib/health/pagerduty-config.ts` (new): read the account-level
  PagerDuty REST API token from env (`HEALTH_ALERT_PAGERDUTY_API_KEY`) — used ONLY to
  *list services* for the setup UI (never to mutate PagerDuty). Also expose the legacy
  single integration key (`HEALTH_ALERT_PAGERDUTY_ROUTING_KEY`) as the fallback.
- **D1 schema** `0007_pagerduty_routing.sql` (or extend plan-30 `alert_routes`):
  `pagerduty_routing(id TEXT PK, owner_id TEXT, match_rule TEXT, match_host TEXT,
  service_name TEXT, routing_key TEXT, enabled INTEGER, created_at INTEGER)`. Store the
  integration/routing key per service (secret-at-rest, like connection secrets).
- **Routing extension** `alert-routing.ts` (plan 30) or a sibling: `resolvePagerDutyTargets(
  routes, { ruleId, ruleType, hostId, hostName }): { serviceName; routingKey }[]` — pure,
  unit-tested glob/`*` matching (reuse plan-30 `matchRoutes` if present). No match ⇒
  `[{ routingKey: envFallbackKey }]` when the env key is set, else `[]`.
- **Route API** `src/routes/api/v1/health/pagerduty-routes.ts` (or fold into plan-30
  `routes.ts`): GET/POST/DELETE owner-scoped; a `GET .../pagerduty/services` helper lists
  PagerDuty services via the REST token for the picker. Writes auth-gated; owner try/catch
  → OSS single-tenant.
- **Sweep dispatch** `server-sweep.ts`: when a finding notifies and its target resolves to
  PagerDuty (URL `events.pagerduty.com` or a routing rule), build the body with the
  **real** key: `buildPagerDutyBody(payload, { routingKey })` for each matched service, and
  POST to the Events API. Preserve `recovery → resolve` and the `chmonitor:{hostId}:{metric}`
  dedup key so PagerDuty collapses/auto-resolves one incident per (host, rule). Run
  `evaluateAlert` once per finding (not per service). Respect plan-28/29 suppression.
- **UI** `src/components/health/pagerduty-setup-dialog.tsx` `(verify dir)`: pick a service
  (from the listed services or paste an integration key), set rule/host match, save/list/
  delete; a "send test event" path to the selected service.

## Open questions (resolve during discovery)
1. **Overlap with plan 30** — does `alert_routes` already model channel targets? If so,
   add `provider:'webhook'|'pagerduty'` + `service_name`/`routing_key` columns there
   instead of a second table. Decide before writing the migration to avoid two schemas.
2. **REST token scope** — the API key is for *reading* services only (list for the picker).
   Confirm we never call PagerDuty write endpoints (creating services/policies is the
   operator's job in PagerDuty). Events API uses the per-service integration/routing key,
   not the REST token.
3. **Dedup identity** — keep `pagerDutyDedupKey = chmonitor:{hostId}:{metric}` (recommended;
   PagerDuty auto-resolves on the `resolve` event). Confirm `metric` == rule id semantics so
   `hostId:ruleId` (sweep dedup) and the PagerDuty dedup key stay aligned.
4. **Escalation "honored"** — chmonitor does nothing special for escalation; it just routes
   to the right service and lets PagerDuty escalate. Confirm that's the intended contract
   (no chmonitor-side escalation timers).
5. **Free vs paid** — is per-service routing advertised as Pro+/Enterprise? Gate via
   `plan-enforcement.ts` only if pricing says so.
6. **Secret storage** — routing keys at rest in D1 (as connection secrets are) vs env-only?
   Default: D1, matching existing secret handling; `(verify)`.

## STOP conditions & drift check
- No D1 / owner throw ⇒ fall back to the single env routing key (or no PagerDuty dispatch
  if unset) — existing single-key setups behave unchanged. Prove with a pure resolver test.
- The REST API token is **read-only usage** (list services). Never call PagerDuty write/
  mutation endpoints. chmonitor pages humans; it does not manage PagerDuty config or run
  remediation.
- Preserve `recovery → resolve` and the stable dedup key so incidents don't duplicate and
  auto-resolve correctly.
- Run `evaluateAlert` once per finding; fan-out to multiple services must not multiply
  cooldown state.
- Coordinate the schema with plan 30 (one routes table if possible) — flag the overlap in
  the PR rather than silently shipping two.
- Do not gate behind a paywall unless pricing marks it paid.

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/health/adapters/ --isolate
cd apps/dashboard && bun test src/lib/health/ --isolate
cd apps/dashboard && bun run lint
```

## Done criteria
- `pagerduty-config.ts` (REST token for service listing + env fallback key) shipped.
- `pagerduty_routing` D1 (or extended `alert_routes`) + pure `resolvePagerDutyTargets`
  with tests for `*` / glob / no-match-fallback.
- Sweep enqueues per-service `trigger`/`resolve` with the real routing key, preserving the
  `chmonitor:{hostId}:{metric}` dedup key and running `evaluateAlert` once per finding.
- Setup dialog lists services (or accepts an integration key), maps rule/host → service,
  and can send a test event.
- Legacy single-key setups behave unchanged; no PagerDuty write/mutation calls; no paywall
  unless pricing dictates.
- All four verification commands pass; open questions (esp. the plan-30 schema overlap)
  answered in the PR description.

Priority: P1 · Effort: L · Depth: E · Wave: A (Alerting) · Lever: Revenue/Adoption
