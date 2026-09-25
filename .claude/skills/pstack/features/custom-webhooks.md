# Custom webhooks and event delivery

Custom alert targets combine Helm/GitOps declarations with owner-scoped D1
overrides. The settings UI can preview a target, and a health sweep or explicit
test can deliver an alert without exposing the target URL or secret headers to
the browser.

## Sub-features

- `webhook-settings` exposes the Alerts surface at `/alert-settings` and the
  existing health-settings route aliases.
- `webhook-targets` shows Helm targets as read-only and D1 targets as editable,
  with a deterministic empty state.
- `webhook-precedence` lets a D1 row override a Helm target by name; a disabled
  D1 row suppresses the Helm target until it is reset.
- `webhook-preview` renders a deterministic sample payload and can optionally
  send a test through the server-side dispatcher.
- `webhook-egress` requires HTTPS, validates public destinations, follows no
  unsafe redirects, and hides credential URLs in previews and errors.
- `webhook-subscriptions` creates user or instance event subscriptions with a
  one-time secret and revalidates destinations.
- `webhook-alert-events` emits `alert.fired` and `alert.resolved` through the
  outbound event bus without allowing a broken subscriber to break the sweep.

## How to get to it (user POV)

- Open `/alert-settings`, choose the Alerts tab, and inspect the custom target
  list.
- Add or edit a D1 target when metadata storage is configured. Helm/GitOps
  targets remain read-only in the UI.
- Use Preview to inspect the formatted sample without sending it. Use an
  explicit test only in an approved environment.
- Open `/inbound-events` to inspect normalized Alertmanager, Datadog, or
  generic events after an external sender has posted to
  `POST /api/events/ingest`.
- Configure instance-scoped alert subscriptions for `alert.fired` and
  `alert.resolved`; user-scoped subscriptions do not own those events.

## Driving it with CI

Preconditions:

- A real destination URL and secret are never required for the default proof.
- Do not send a live alert to a third-party endpoint from a validation run.

- **Formatting, validation, and redaction.** In `.github/workflows/test.yml`,
  job `unit-tests`, inspect `lib/health/custom-webhook-targets.test.ts`,
  `custom-webhook-env.test.ts`, `alert-webhook-events.test.ts`,
  `alert-routing-auth.test.ts`, `custom-webhook-target-store.sql.test.ts`, and
  the adapter dispatch tests. These cover HTTPS, header sanitization, template
  bounds, URL redaction, owner isolation, and event mapping.
- **Outbound route safety.** Inspect
  `routes/api/v1/health/webhook.test.ts` and
  `lib/health/sweep/dispatch/webhook-post.test.ts`. The proof is that blocked
  destinations perform no fetch, authorized calls use the expected method and
  body, redirects are rejected, and errors do not retain credential URLs.
- **CRUD and preview.** Inspect the route implementation together with
  `components/health/custom-webhook-target-card.test.tsx` and the
  `custom-webhook-config.test.ts` / `custom-webhook-targets.test.ts` unit
  contracts. The observable state is masked URL data, `source: helm|d1`, and
  deterministic preview content.
- **Helm/GitOps render.** In `.github/workflows/k8s-lint.yml`, job `helm`,
  run `deploy/helm/chmonitor/tests/test-alert-webhooks.sh`. It proves the chart
  keeps secret-bearing values out of the ConfigMap, emits the expected
  references, and rejects invalid formats and plain HTTP URLs.
- **Sweep and events.** The `unit-tests` job covers
  `routes/api/cron/__tests__/health-sweep.test.ts` and the alert event bus.
  A real sweep remains deployment- and credential-dependent.
- **Evidence.** Record the source of the target, whether the operation was
  preview or send, the route/test family, and the observed masked state. Do
  not paste a full URL, secret header, response body, or D1 row containing a
  credential.

## Gotchas

- A D1 target with the same name as a Helm target wins; deleting the D1 row
  exposes the Helm declaration again.
- A disabled D1 row is not the same as deleting it. The UI intentionally
  suppresses the Helm target while the override exists.
- Public target data may include a masked URL and public headers, never the raw
  credential URL or secret headers.
- `Authorization` and `Cookie` can come only from modeled secret configuration,
  not from the public draft parser.
- The health webhook proxy and the event subscription API are SSRF sinks. Their
  safety tests inject a fetch double; a successful mock is not a live send.
- `alert.fired` and `alert.resolved` are instance-scoped. Creating a user-scoped
  subscription for them is a contract error, not a quiet no-op.
- A failed outbound subscriber must not create an unhandled rejection or abort
  the health sweep. Preserve that negative evidence when reviewing the alert
  path.
