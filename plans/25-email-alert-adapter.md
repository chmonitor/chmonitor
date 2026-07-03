# 25 — Email alert adapter (Mailgun / SendGrid / SMTP)

## Current reality (audited)
- Email is the universal alert channel; adapters cover Slack/Discord/Telegram/PagerDuty/generic but NOT email.
- Adapter layer: `apps/dashboard/src/lib/health/adapters/` — `types.ts` defines the PURE `NotificationAdapter` (`id`, `detect?(url)`, `buildBody(payload)`) and `AlertPayload`; `index.ts` holds `ADAPTERS`, `ALL_ADAPTERS`, `detectAdapter(url)`. Existing adapters (`slack.ts`, `discord.ts`, `telegram.ts`, `pagerduty.ts`, `generic-json.ts`) are pure formatters; transport is applied by `alert-dispatcher.ts`.
- Server env config: `apps/dashboard/src/lib/health/server-alert-config.ts` reads `process.env.HEALTH_ALERT_*` (trimmed; finite-number helpers) → `AlertSettings`. Follow this exact style.
- Settings UI: `apps/dashboard/src/components/health/health-settings-dialog.tsx` (verify filename).

## Goal
An email adapter renders a clean HTML alert (host, check, value, thresholds, runbook link), detects a provider from a config URL/env (`mailgun://`, `sendgrid://`, SMTP), the server reads recipients + from-address from env, and operators can send a test email from health settings — same PURE-builder + registry parity as existing adapters.

## Implement now
**A. Adapter — new `apps/dashboard/src/lib/health/adapters/email.ts`** (mirror `pagerduty.ts`):
```ts
export type EmailProvider = 'mailgun' | 'sendgrid' | 'smtp'
export interface EmailConfig { provider: EmailProvider; from: string; to: readonly string[] }
export interface EmailBody { subject: string; html: string; text: string }
export function buildEmailBody(payload: AlertPayload): EmailBody
export function detectEmailProvider(url: string): EmailProvider | null
export const emailAdapter: NotificationAdapter // id:'email', buildBody → buildEmailBody
```
- `subject`: `[SEVERITY] {metric} on {hostLabel}` (uppercase severity; `recovery` → `[RESOLVED]`).
- `html`: table with host label/id, check title + metric, observed value, warn/crit thresholds, timestamp, runbook links (`payload.runbookUrls`) as `<a>`. HTML-encode all interpolated values. Inline styles only; small + client-safe.
- `text`: plaintext mirror.
- `emailAdapter.detect` matches provider config URLs (mailgun/sendgrid/smtp/smtps) and returns false for http(s) so it never hijacks webhook routing.

**B. Register — `adapters/index.ts`**: export `buildEmailBody`, `emailAdapter`, and the `EmailProvider`/`EmailConfig`/`EmailBody` types. Add `emailAdapter` to `ADAPTERS` (or keep out of URL-detection list and dispatch explicitly if email is env-selected — decide with the dispatch layer). Update the adapter snapshot test.

**C. Server config — `server-alert-config.ts`** (match `process.env.HEALTH_ALERT_*` + `.trim()` style): add `HEALTH_ALERT_EMAIL_ENABLED` (bool, default false), `HEALTH_ALERT_EMAIL_TO` (comma-sep, ''), `HEALTH_ALERT_EMAIL_FROM` ('') , `HEALTH_ALERT_EMAIL_PROVIDER_URL` (mailgun://KEY@DOMAIN | sendgrid://KEY | smtp://user:pass@host:port). Add `getServerEmailConfig(): EmailConfig | null` (null when disabled/unconfigured → fail-open). Keep `getServerAlertConfig`'s `AlertSettings` shape untouched (add email as a companion fn, like `getServerThresholdOverrides`).

**D. Dispatch — `alert-dispatcher.ts`** (verify): when email enabled, send the built body via the detected provider's HTTP API (Mailgun/SendGrid REST) or SMTP. Provider secret resolution stays in dispatch, not the pure adapter. Handle send failure gracefully (log; do not throw into the sweep).

**E. Settings UI — `health-settings-dialog.tsx`** (verify filename): add recipient/from fields + a "Send test email" button posting to the test-send path, surfacing success/failure (mirror existing webhook test).

## STOP conditions & drift check
- STOP if pure `buildEmailBody` starts doing network/transport (belongs in dispatch).
- STOP if adding `emailAdapter` to `ADAPTERS` changes `detectAdapter` routing for existing http(s) webhook URLs — email `detect` must not match webhook URLs.
- Drift: if the adapter registry / `NotificationAdapter` shape changed, match the current contract; if `health-settings-dialog.tsx` moved/renamed, find the real settings surface.
- No Postgres; don't touch AI/DDL behaviour.

## Done criteria
- `buildEmailBody(payload)` returns `{subject, html, text}` with escaped values, thresholds, runbook links (unit test + snapshot).
- `detectEmailProvider` maps mailgun/sendgrid/smtp(s) correctly; unknown → null.
- `emailAdapter` satisfies `NotificationAdapter` and passes the adapter-parity test.
- `getServerEmailConfig` reads `HEALTH_ALERT_EMAIL_*`, null when unconfigured (fail-open); `AlertSettings` unchanged.
- Dispatch sends via detected provider, fails gracefully.
- Health settings has recipient config + working "Send test email".
- No Postgres; type-check, targeted tests, lint green.
