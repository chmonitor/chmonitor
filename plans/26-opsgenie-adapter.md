# 26 — Opsgenie alert adapter

## Kickoff prompt

```text
Execute plans/26-opsgenie-adapter.md ALONE (Wave A, Alerting, Depth F — file-level spec below).
Add an Opsgenie notification adapter with parity to the existing PagerDuty adapter: a PURE body
builder that targets the Opsgenie Alert API, severity mapping, a stable dedup/alias key,
host/rule tags, URL detection, registry registration, and a settings test-send.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE: Opsgenie is opt-in via env; unconfigured = no behaviour change.
  No Clerk required (alerting works on every deployment).
- Enterprise features are edition-gated and must NOT degrade OSS — Opsgenie is a core alerting
  channel, NOT enterprise-gated.
- AI recommends DDL, never auto-applies (unaffected).
- Postgres = NO.

Keep the body builder PURE (no transport), exactly like adapters/pagerduty.ts. End with the
Verification commands + results.
```

## Current reality (audited)

- **Why (spec 26):** Opsgenie is a major on-call vendor with **no adapter**. PagerDuty is the
  closest analog and is a clean template.
- Reference adapter: `apps/dashboard/src/lib/health/adapters/pagerduty.ts` — pure
  `buildPagerDutyBody(payload, config)`, `SEVERITY_MAP` (`critical→critical`, `warning→warning`,
  `recovery→info`), `pagerDutyDedupKey(payload)` = `` `chmonitor:${hostId}:${metric}` ``, and
  `pagerDutyAdapter` with `detect: /events\.pagerduty\.com/`. Mirror this structure.
- Registry: `apps/dashboard/src/lib/health/adapters/index.ts` (`ADAPTERS`, `detectAdapter`).
- Env config style: `apps/dashboard/src/lib/health/server-alert-config.ts`
  (`process.env.HEALTH_ALERT_*`, trimmed).
- Settings UI: `apps/dashboard/src/components/health/health-settings-dialog.tsx` `(verify)`.

## Goal

An Opsgenie adapter posts a well-formed **Alert API** create/close request, maps our severity to
Opsgenie priority, uses a stable `alias` so repeat firings collapse to one Opsgenie alert (and
`recovery` closes it), tags the alert with host + rule, is detected from an Opsgenie URL, and is
test-sendable from settings — parity with PagerDuty.

## Implement now

**A. Adapter — new `apps/dashboard/src/lib/health/adapters/opsgenie.ts`** (mirror `pagerduty.ts`)

Target the Opsgenie Alert API v2 (`https://api.opsgenie.com/v2/alerts`; EU:
`https://api.eu.opsgenie.com/v2/alerts`). Auth is `Authorization: GenieKey <API_KEY>` (applied
by the dispatch layer, not the pure builder).

```ts
export type OpsgeniePriority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5'

const SEVERITY_MAP: Record<AlertSeverity, OpsgeniePriority> = {
  critical: 'P1',
  warning:  'P2',
  recovery: 'P3', // used only for the close path label; recovery closes the alias
}

export interface OpsgenieConfig { apiKey: string }   // resolved by dispatch layer

export interface OpsgenieCreateBody {
  message: string          // "{title} — {label} (host {hostLabel})"
  alias: string            // stable dedup: opsgenieAlias(payload)
  priority: OpsgeniePriority
  source: string           // 'chmonitor'
  tags: string[]           // ['host:{hostLabel}', 'metric:{metric}', 'chmonitor']
  details: Record<string, string> // hostId, metric, value, thresholds, timestamp
  description?: string     // includes runbook URLs
}

/** Stable alias so repeat firings collapse to one Opsgenie alert. */
export function opsgenieAlias(payload: AlertPayload): string {
  return `chmonitor:${payload.hostId}:${payload.metric}`
}

export function buildOpsgenieBody(payload: AlertPayload): OpsgenieCreateBody
export const opsgenieAdapter: NotificationAdapter // id: 'opsgenie'
```

- `recovery` maps to a **close** action on the alias, not a create — expose enough for the
  dispatch layer to choose create vs. `POST /v2/alerts/{alias}/close?identifierType=alias`
  (mirror PagerDuty's `trigger`/`resolve` split). Keep the builder pure; return an intent the
  dispatcher acts on, or a discriminated body.
- `opsgenieAdapter.detect`: `` /(?:^|\/\/)api(?:\.eu)?\.opsgenie\.com\//i `` so `detectAdapter`
  can route an Opsgenie URL.
- Escape/normalize interpolated fields; `details` values must be strings (Opsgenie requirement).

**B. Register — `apps/dashboard/src/lib/health/adapters/index.ts`**
- Export `buildOpsgenieBody`, `opsgenieAdapter`, `opsgenieAlias`, and the Opsgenie types.
- Add `opsgenieAdapter` to `ADAPTERS` **before** the generic fallback. Update the adapter
  snapshot test.

**C. Server config — `apps/dashboard/src/lib/health/server-alert-config.ts`**
Add (matching existing style):
```
HEALTH_ALERT_OPSGENIE_API_KEY   → string (default '') ; empty ⇒ disabled (fail-open no-op)
HEALTH_ALERT_OPSGENIE_REGION    → 'us' | 'eu' (default 'us')  # picks api base host
```
Expose `getServerOpsgenieConfig(): OpsgenieConfig | null` as a companion function; do not alter
`getServerAlertConfig`'s `AlertSettings` shape.

**D. Dispatch (transport)** — `apps/dashboard/src/lib/health/alert-dispatcher.ts` (`(verify)`):
when configured, `POST` create on trigger and close on recovery, with the `GenieKey` header and
the region-appropriate base URL. Fail gracefully (log; never throw into the sweep).

**E. Settings UI** — add an Opsgenie API-key field and a **"Send test alert"** button to
`health-settings-dialog.tsx` (`(verify)` filename), mirroring the existing test affordance.

## STOP conditions & drift check

- **STOP** if the pure builder starts making network calls or embedding the API key — auth +
  transport belong to the dispatch layer (parity invariant).
- **STOP** if adding `opsgenieAdapter` to `ADAPTERS` breaks `detectAdapter` for existing URLs —
  the detect regex must match only Opsgenie hosts.
- **Drift check:** if `NotificationAdapter`/registry changed, match the current contract; if the
  settings dialog moved, find the real surface first.
- No Postgres; do not touch AI/DDL behaviour.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/health/adapters --isolate
cd apps/dashboard && bun test src/lib/health/server-alert-config.test.ts --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

- [ ] `buildOpsgenieBody(payload)` returns a well-formed Alert API body: message, `alias`,
  `priority` (P1/P2 mapped), `source:'chmonitor'`, host+metric tags, string `details`, runbook
  in description (unit test; snapshot added).
- [ ] `opsgenieAlias` = `chmonitor:{hostId}:{metric}`; repeated firings share it; `recovery`
  closes the alias (dedup test).
- [ ] `opsgenieAdapter` satisfies `NotificationAdapter`, `detect` matches
  `api.opsgenie.com` / `api.eu.opsgenie.com`, and passes the adapter-parity test.
- [ ] `getServerOpsgenieConfig` reads `HEALTH_ALERT_OPSGENIE_API_KEY`, null when empty
  (fail-open); `AlertSettings` shape unchanged.
- [ ] Dispatch posts create/close correctly and fails gracefully.
- [ ] Health settings has an Opsgenie key field + working "Send test alert".
- [ ] No Postgres. type-check, build, targeted tests, lint all green.

---

Priority P1 · Effort M · Depth F · Wave A (Alerting) · Lever Adoption/Revenue
