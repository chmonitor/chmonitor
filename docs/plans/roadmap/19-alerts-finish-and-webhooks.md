# 19 — Finish Alerting: Rule CRUD + Management UI + Provider Webhooks

> Priority: P1 · Effort: M · Risk: MED · Depends on: none (soft-links 13 billing)
> Category: Painpoint/feature · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

Alerting is 80% built but has three visible gaps:

1. **No alert-rule CRUD.** Rules are hardcoded in
   `lib/alerting/builtin-rules.ts` (`BUILTIN_RULES`) and registered via
   `lib/alerting/rule-registry.ts`. There is **no create/update/delete path** — a
   user cannot add or tune a rule beyond editing thresholds. Because there is no
   create path, the Pro/Max **`alertRules` limit is unenforceable**:
   `lib/billing/plan-enforcement.ts` explicitly marks it
   `status: 'deferred', reason: 'No alert-rule create path exists yet.'`, and
   `alerting_basic` / `alerting_advanced` / `webhook_integrations` are all
   `status: 'deferred'`.
2. **Webhooks aren't really wired for real destinations.** The dispatcher
   (`lib/health/alert-dispatcher.ts` `fireWebhook`) and the server sweep
   (`lib/health/server-sweep.ts` `postWebhook`) POST a **single plain-text
   payload** (`{ url, text }` / `{ text, content }`) to one webhook URL from
   `alert-settings` / `HEALTH_ALERT_WEBHOOK_URL`. There is **no Slack /
   PagerDuty / custom provider formatting**, no multiple destinations, and no
   per-rule routing. Slack needs `{ text }` blocks, PagerDuty needs an Events-v2
   `routing_key` + `event_action` payload — neither exists.
3. **Threshold/webhook config is browser-local** (`lib/health/thresholds-storage.ts`,
   `alert-settings-storage.ts` — `localStorage`) with a parallel env-only server
   config (`server-alert-config.ts`), so nothing is per-user-persisted the way
   connections are (`routes/api/v1/user-connections.ts` → D1 store).

## Goal

A signed-in user can **create, edit, and delete alert rules** (name, SQL/valueKey,
warning/critical thresholds) and configure **provider-specific webhook
destinations (Slack / PagerDuty / custom)** from an Alerts management UI; the
server sweep delivers to those destinations with correctly-formatted payloads;
and the **`alertRules` plan cap is enforced** at the create endpoint (flipping
`alertRules`, `alerting_basic`, `webhook_integrations` from `deferred` →
`enforced` in `plan-enforcement.ts`).

## Design

### 1. Persistence — D1 store mirroring connections

Add `lib/alerting/alert-rule-store.ts` (interface) + a D1 implementation mirroring
`lib/connection-store/d1-store.ts` (list / get / create / update / delete /
`countByUser`, per-user rows keyed by resolved user id). A `custom` user rule has
the same shape as `AlertRuleDef` (`id`, `type: 'custom'`, `title`, `description`,
`sql`, `valueKey`, `defaults: { warning, critical }`, `optional?`, `tableCheck?`).
`rule-registry.ts` stays the in-memory registry; the sweep merges builtin rules +
the user's persisted rules. Self-hosted with no D1 falls back to the current
builtin-only behaviour (fail-closed to OSS — never break self-host).

Add `lib/alerting/webhook-destinations-store.ts` (D1, per-user): each destination
`{ id, provider: 'slack'|'pagerduty'|'custom', url|routingKey, minSeverity, enabled }`.

### 2. CRUD API route (mirror user-connections.ts)

Add `routes/api/v1/alert-rules.ts` with GET (list) / POST (create) / PUT / DELETE,
following `user-connections.ts` exactly (`createFileRoute('/api/v1/alert-rules')`,
`createSuccessResponse` / `createErrorResponse`, `resolve*` user + store seams).
**Enforce the cap in POST** the same way hosts are enforced
(`checkHostLimit` → `hostLimitResponse`): resolve the billing owner
(`resolveBillingOwner` / `getPlanForOwner`), `countByUser`, and 402 when
`count >= plan.limits.alertRules`. Also gate the whole route on the capability via
`requirePlanCapability('alerting_basic', request)` (returns `null`/allows on OSS,
402 on cloud free) — same helper the export path will use.

Add `routes/api/v1/alert-webhooks.ts` (CRUD for destinations), gated by
`requirePlanCapability('webhook_integrations', request)`.

### 3. Provider-aware webhook formatting

Add `lib/health/webhook-providers.ts` with a pure `formatWebhookPayload(provider, alert)`:

- `slack` → `{ text: "..." , blocks: [...] }` (severity emoji + host + label).
- `pagerduty` → Events API v2 `{ routing_key, event_action: 'trigger'|'resolve', payload: { summary, severity: 'warning'|'critical', source: host } }` (map `kind: 'recovery'` → `resolve`).
- `custom` → the current `{ text, content }` shape (backward compatible).

The server sweep (`server-sweep.ts`) and the `/api/v1/health/webhook` proxy call
`formatWebhookPayload` per destination instead of hardcoding the text body. Keep
the existing SSRF validation on the proxy. This function is **pure and unit-testable**
(the real test below), which is why formatting lives in its own module rather than
inline in the fetch.

### 4. Management UI

Extend the existing Health surface (`routes/(dashboard)/health.tsx`,
`components/health/health-settings-dialog.tsx`) with an **Alert Rules** section:
list rules (builtin read-only + user rules editable), a create/edit form (title,
SQL, valueKey, warning/critical), delete, and a **Destinations** tab (add Slack /
PagerDuty / custom, test-send button). Show a plan-gated upsell when the cap is
hit (reuse the 402 → upgrade pattern). No new top-level route required; if it
grows, add `routes/(dashboard)/alerts.tsx` + a `menu.ts` entry mirroring Health.

### 5. Flip enforcement flags

In `lib/billing/plan-enforcement.ts`: `alertRules` → `enforced`
(`gate: 'routes/api/v1/alert-rules.ts handlePost → checkAlertRuleLimit'`),
`alerting_basic` → `enforced`, `webhook_integrations` → `enforced`.
Update `docs/content/**` pricing/alerting docs in the same change.

## Steps

1. `lib/alerting/alert-rule-store.ts` interface + D1 impl (mirror `connection-store/d1-store.ts`) + `countByUser`.
2. `lib/alerting/webhook-destinations-store.ts` (D1) + types.
3. `lib/health/webhook-providers.ts` — pure `formatWebhookPayload` for slack/pagerduty/custom (**the testable unit**).
4. `routes/api/v1/alert-rules.ts` CRUD + cap enforcement (`checkAlertRuleLimit` mirroring `checkHostLimit`) + `requirePlanCapability('alerting_basic')`.
5. `routes/api/v1/alert-webhooks.ts` CRUD + `requirePlanCapability('webhook_integrations')`.
6. Wire `server-sweep.ts` + `/api/v1/health/webhook` to load user destinations and send via `formatWebhookPayload`; merge user rules into the sweep's rule set.
7. UI: Alert Rules + Destinations sections in `health-settings-dialog.tsx` (create/edit/delete + test-send + upgrade upsell on 402).
8. Flip the three enforcement flags in `plan-enforcement.ts`; update pricing/alerting docs.
9. Tests (below); update roadmap status row.

> Effort is M but near the L boundary: if steps 1–6 (backend) overrun, split UI
> (step 7) into a child plan **19a — Alerts management UI** and ship backend +
> flag enforcement first.

## Real test

`lib/health/webhook-providers.test.ts` (Bun) — **fails today** (module absent),
passes after; the load-bearing correctness is the provider payloads and the
recovery→resolve mapping:

```ts
import { describe, expect, test } from 'bun:test'
import { formatWebhookPayload } from './webhook-providers'

const alert = {
  checkId: 'readonly-replicas', title: 'Readonly Replicas',
  severity: 'critical' as const, value: 4, label: '4 readonly replicas',
  hostId: 0, kind: 'alert' as const,
}

describe('formatWebhookPayload', () => {
  test('slack payload carries a text summary', () => {
    const p = formatWebhookPayload('slack', alert) as { text: string }
    expect(p.text).toContain('Readonly Replicas')
    expect(p.text).toContain('CRITICAL')
  })
  test('pagerduty maps critical alert → trigger with events-v2 shape', () => {
    const p = formatWebhookPayload('pagerduty', { ...alert, routingKey: 'RK' }) as any
    expect(p.event_action).toBe('trigger')
    expect(p.payload.severity).toBe('critical')
  })
  test('pagerduty maps recovery → resolve', () => {
    const p = formatWebhookPayload('pagerduty', { ...alert, kind: 'recovery', routingKey: 'RK' }) as any
    expect(p.event_action).toBe('resolve')
  })
})
```

Add `routes/api/v1/alert-rules.test.ts` asserting POST returns **402** once
`countByUser >= plan.limits.alertRules` (the cap-enforcement assertion that was
impossible before this plan), mirroring the host-limit test.

## Verification

```
cd apps/dashboard && bun test src/lib/health/webhook-providers.test.ts
cd apps/dashboard && bun test src/routes/api/v1/alert-rules.test.ts
bun run lint && bun run build
```

## Out of scope / STOP conditions

- No new alerting engine — reuse `rule-registry`, `classifyValue`, `server-sweep`, cron `/api/cron/health-sweep`.
- No email/SMS/OpsGenie providers this plan (only Slack, PagerDuty, custom).
- No alert history/incident timeline UI (defer).
- Self-hosted with no D1 keeps builtin-only rules + env webhook — **do not** make CRUD a hard dependency of the sweep (fail-closed to OSS).
- STOP and split per the note above if backend overruns; never ship the UI without the cap enforced.

## Done

- [ ] Alert-rule + webhook-destination D1 stores; CRUD routes with cap + capability enforcement.
- [ ] `formatWebhookPayload` delivers correct Slack/PagerDuty/custom payloads from the sweep; test-send works.
- [ ] `alertRules`, `alerting_basic`, `webhook_integrations` flipped to `enforced` in `plan-enforcement.ts`.
- [ ] Real tests fail before / pass after; `bun run lint && bun run build` green.
- [ ] Pricing/alerting docs updated (user-facing); OSS builtin-only fallback verified.
- [ ] Update the status row for **19** in `plans/roadmap/README.md` (→ IN REVIEW/DONE).
