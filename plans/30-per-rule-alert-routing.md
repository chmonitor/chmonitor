# 30 — Per-rule / per-host alert routing

## Kickoff prompt

```text
Execute plans/30-per-rule-alert-routing.md alone (zero prior context). This is an
EPIC brief — do light discovery first (resolve the "(verify)" paths below), then build.
Goal: replace the single global webhook with per-rule/per-host routing to one or more
channels, with multi-channel fan-out and a legacy fallback to the global URL.
Invariants you MUST hold:
- Self-hosted/OSS stays whole; fail OPEN without Clerk (no D1 / owner throw ⇒ fall back
  to the legacy global HEALTH_ALERT_WEBHOOK_URL; never crash the sweep).
- AI/alerts RECOMMEND but NEVER auto-apply destructive DDL; routing only decides WHERE a
  notification goes — remediation stays ACK-gated (plans 29/33).
- Honest paywalls: if routing is positioned as a paid capability, gate it via
  lib/billing/plan-enforcement.ts and mark it enforced|deferred honestly; otherwise ship
  free. Default this plan to FREE unless the pricing table says routing is Pro+.
- Postgres = NO. D1 only (mirror insights/store/d1-store.ts).
Build ONLY §"Implement now". Respect STOP conditions. Then run every command in
§Verification and paste output.
```

## Current reality (audited)

**Why (spec):** there is one global webhook for all rules/hosts; teams need per-rule
and per-host routing to different channels.

File pointers (verified):
- Sweep + dispatch: `apps/dashboard/src/lib/health/server-sweep.ts` — `runHealthSweep`
  reads a single `settings.webhookUrl` (`getServerAlertConfig`) and `postWebhook(url,
  text)` posts one flat message per notifying finding (dispatch block ~L242–268).
- Config: `apps/dashboard/src/lib/health/server-alert-config.ts`
  (`HEALTH_ALERT_WEBHOOK_URL/_ENABLED/_MIN_SEVERITY`).
- Dedup: `apps/dashboard/src/lib/health/alert-state-store.ts` (`evaluateAlert`,
  key `hostId:ruleId`). Adapters + `detectAdapter`: `adapters/index.ts`; `AlertPayload`
  in `adapters/types.ts`. Rules: `lib/alerting/rule-registry.ts` (`AlertRuleDef.id/type`).
- D1 pattern: `insights/store/d1-store.ts`. Migrations:
  `src/db/conversations-migrations/NNNN_*.sql` (next after `0006`).
- Health UI dir: **not found** at audit — `components/health/*` is `(verify)`; colocate
  with the existing health-settings component.

## Goal

An operator defines routes that match a rule id/type and/or host (glob or `*`) to one
or more channel webhook URLs. When a finding notifies, the sweep dispatches to **all
matching routes** (fan-out), records each delivery, and falls back to the legacy global
webhook when no route matches — preserving today's behavior for existing deployments.

## Implement now (approach + key files)

- **D1 schema** `0007_alert_routes.sql`: `alert_routes(id TEXT PK, owner_id TEXT,
  match_rule TEXT, match_host TEXT, channel_url TEXT, enabled INTEGER, created_at INTEGER)`.
  `match_rule` / `match_host` accept `*` or a glob (`match_host` matches host id or
  name). Index on `(owner_id, enabled)`.
- **Routing module** `src/lib/health/alert-routing.ts`:
  - `interface AlertRoute { id; ownerId; matchRule; matchHost; channelUrl; enabled }`.
  - D1-backed CRUD (`listRoutes/createRoute/deleteRoute`, mirror insights store, swallow
    failures ⇒ fail-open to `[]`).
  - **Pure core** `matchRoutes(routes, { ruleId, ruleType, hostId, hostName }):
    AlertRoute[]` — export separately, unit-test the glob/`*`/id-vs-name matching.
  - `resolveTargets(routes, finding, legacyGlobalUrl): string[]` — matched channel URLs,
    or `[legacyGlobalUrl]` when none match (and the global URL is configured).
- **Route API** `src/routes/api/v1/health/routes.ts`: GET/POST/DELETE, owner-scoped,
  writes auth-gated, owner resolution try/catch → OSS single-tenant (`ownerId=''`).
- **Sweep dispatch** `server-sweep.ts`: load `routes` once before the host loop; in the
  dispatch block, replace the single `postWebhook(settings.webhookUrl, text)` with a
  loop over `resolveTargets(routes, finding, settings.webhookUrl)` — build the body per
  channel via `detectAdapter(url).buildBody(payload)` (`(verify)` whether to keep the
  flat `{text,content}` for back-compat or switch to adapter bodies; if switching is too
  broad, fan out the flat text to each URL and mark adapter-per-channel `(verify)`).
  Count each successful delivery; record each (delivered/error) to plan-27 history if
  present. Preserve dedup: run `evaluateAlert` **once** per finding (not per route) so a
  single condition doesn't multiply cooldown state.
- **UI** `src/components/health/alert-routing-dialog.tsx` `(verify dir)`: list/create/
  delete routes (rule picker or `*`, host picker or `*`, channel URL); "test route"
  reuses the existing settings test-send.

## Open questions (resolve during discovery)
1. **Adapter bodies vs flat text in the sweep** — does the cron sweep already build
   `AlertPayload`/adapter bodies, or only flat `{text,content}`? (Audit says flat.) If
   flat, decide: fan out flat text now (smaller change) vs. wire adapter bodies (nicer,
   broader). Ship flat + `(verify)` if time-boxed.
2. **Dedup granularity** — keep dedup at `hostId:ruleId` (condition-level, recommended)
   so fan-out to N channels is one decision, OR make it per-route? Default: condition-level.
3. **Owner source for the sweep** — the sweep is currently owner-agnostic; how does it
   learn whose routes to load? (`''` OSS single-tenant is acceptable for self-host.)
4. **Free vs paid** — is per-rule routing advertised as Pro+ in `@chm/pricing`? If yes,
   gate via `plan-enforcement.ts`; if not, ship free. Do not invent a paywall.
5. **Channel secret storage** — channel URLs may contain secrets; confirm D1-at-rest is
   acceptable (it already stores connection secrets) or reference an env indirection.

## STOP conditions & drift check
- No D1 / owner throw ⇒ `matchRoutes` sees `[]` ⇒ `resolveTargets` returns the legacy
  global URL ⇒ **today's behavior exactly**. Prove with a pure test (no D1).
- Run `evaluateAlert` once per finding; fan-out must not reset cooldown per channel.
- Do not add auto-remediation; routing only chooses destinations.
- Reuse the SSRF-guarded outbound post path already used by the sweep/webhook proxy —
  do not introduce a new unguarded `fetch` to arbitrary URLs.
- If pricing doesn't mark routing paid, do NOT gate it (honest paywalls).

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/health/alert-routing.test.ts --isolate
cd apps/dashboard && bun test src/lib/health/ --isolate
cd apps/dashboard && bun run lint
```

## Done criteria
- `alert_routes` D1 + `alert-routing.ts` (pure `matchRoutes`/`resolveTargets`) shipped
  with tests for `*` / glob / id-vs-name / no-match-fallback.
- CRUD route owner-scoped, writes auth-gated, fails open to legacy global URL.
- Sweep fans out to all matched channels, records each delivery, dedups once per
  condition, and falls back to the global webhook when nothing matches.
- Back-compat: deployments with only `HEALTH_ALERT_WEBHOOK_URL` behave unchanged.
- Routing dialog can create/list/delete/test routes.
- All four verification commands pass; open questions answered in the PR description.

Priority: P1 · Effort: L · Depth: E · Wave: A (Alerting) · Lever: Revenue/Adoption
