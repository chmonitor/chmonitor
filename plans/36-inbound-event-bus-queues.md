# 36 — Inbound event bus (Cloudflare Queues)

## Kickoff prompt

```text
Execute plans/36-inbound-event-bus-queues.md ALONE (do not read other plans).
Goal: add an INBOUND event bus so chmonitor can ingest Alertmanager/Datadog/generic
events, normalize + dedup them, retain ~30d in D1, and optionally re-emit to the
existing outbound alert routes. Ingest is async via Cloudflare Queues.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE and FAILS OPEN: Cloudflare Queues are cloud-only. On
  self-host (no Queue binding) the ingest endpoint must degrade to a synchronous
  inline path (or a clearly-disabled 501) — never crash, never require Clerk.
- SSRF: any re-emit / outbound delivery MUST go through the existing SSRF-guarded
  webhook proxy — do not add a raw fetch to attacker-suppliable URLs.
- Honest claims: only surface event sources you actually normalize.
- Postgres/multi-DB: NO. Storage is Cloudflare D1 only.

External setup required (document, don't assume): a Cloudflare Queue must be created
and bound in wrangler.toml before the consumer runs.

When done, run the Verification block and paste the output.
```

## Current reality (audited)

Why (roadmap §4/36, P1/L/E): alerting today is **outbound-only** — chmonitor fans alerts
*out* to Slack/Discord/Telegram/PagerDuty/generic webhooks, but there is **no way to ingest**
Alertmanager/Datadog/generic events *in* for correlation and fan-out. Per strategy §1
("meet teams in their stack"), an inbound bus lets chmonitor sit in an existing alerting
mesh rather than replace it.

Pointers (verify at head):
- `apps/dashboard/wrangler.toml` — currently declares `[[d1_databases]]` + `[[migrations]]`
  but **no** `[[queues.*]]`. This plan adds a producer binding + `[[queues.consumers]]`.
- Outbound delivery + SSRF guard live under `apps/dashboard/src/lib/health/` (the webhook
  proxy the alert adapters already use) `(verify exact module)` — reuse it for re-emit.
- Route convention: `apps/dashboard/src/routes/api/…`; D1 migrations live alongside the
  existing migrations referenced from `wrangler.toml`.

## Goal

`POST /api/events/ingest` accepts an event, enqueues it (cloud) or handles it inline
(self-host), a consumer normalizes Alertmanager/Datadog/generic shapes into one schema,
dedups by content hash, upserts into an `event_log` D1 table retained ~30d, optionally
re-emits to configured outbound routes, and an "Inbound Events" page lists/filters them.

## Implement now (depth E — approach + key files + open questions)

### Approach
1. **Ingest** — `apps/dashboard/src/routes/api/events/ingest.ts` (new). Accept POST body;
   validate size/shape; if a Queue binding is present, `env.QUEUE.send(raw)` and return
   `202 Accepted`. If **no** binding (self-host), run the normalize+store path inline and
   return `200`. Authenticate the endpoint with a per-source shared token/header — do **not**
   require Clerk (fail-open for OSS). Rate-limit.
2. **Consumer** — a queue handler that normalizes + upserts. Detect source by payload
   signature: Alertmanager (`{alerts:[…], commonLabels}`), Datadog (`{alert_type, aggreg_key}`),
   else generic. Normalize to `{ id, source, received_at, severity, resource, title, body,
   labels, dedup_hash }`.
3. **Dedup** — hash on `(source, resource, title, severity)` (verify fields); upsert so a
   repeat within the retention window updates `last_seen`/`count` rather than duplicating.
4. **Retain 30d** — prune via the existing retention cron pattern `(verify cron route)` or a
   `WHERE received_at > now()-30d` read filter + periodic delete.
5. **Re-emit (optional)** — if configured, forward the normalized event to the existing
   outbound alert routes **through the SSRF-guarded proxy**. Off by default.
6. **UI** — new "Inbound Events" page under the dashboard routes with source/severity/date
   filters, reading a `GET /api/events` list endpoint.

### Key files
- `apps/dashboard/wrangler.toml` — add producer binding + `[[queues.consumers]]` (queue
  name, `max_batch_size`, `max_retries`, dead-letter queue). Mirror for `env.preview`.
- `apps/dashboard/src/routes/api/events/ingest.ts` (new) + `…/api/events/index.ts` (list).
- `apps/dashboard/src/lib/events/normalize.ts` (new) — source detection + normalization.
- `apps/dashboard/src/lib/events/event-store.ts` (new) — D1 upsert/list/prune.
- New D1 migration for `event_log` (added to the migrations list in `wrangler.toml`).
- New "Inbound Events" route/page under `apps/dashboard/src/routes/(dashboard)/` `(verify group)`.

### Open questions
- Does the platform expose a single ClickHouse-side or D1-only path for the list query, and
  is there an existing "events"-like table to avoid name collision? (Grep `event_log`.)
- Is there an existing generic-webhook auth token convention to reuse for the source token,
  or does this introduce a new secret? (Reuse if present.)
- Queue consumer entrypoint wiring in a TanStack-Start-on-Workers app — confirm where the
  `queue()` export lives relative to `fetch()` `(verify worker entry)`.

### External setup (must be documented in the plan output / docs)
- Create the Queue: `wrangler queues create chmonitor-inbound-events` (+ a DLQ).
- Bind producer + consumer in `wrangler.toml`; redeploy.
- Self-host has no Queues → inline path is the supported mode; document that clearly.

## STOP conditions & drift check

- STOP if `wrangler.toml` already binds a Queue for another purpose — reconcile naming; do
  not repurpose an unrelated queue.
- STOP if re-emit would require a raw `fetch` to a user-supplied URL outside the existing
  SSRF guard — route it through the guard or defer re-emit.
- DRIFT: if the self-host build has no way to reach the inline path (e.g. the route assumes a
  binding), fix the fail-open path before shipping. OSS must not 500.
- Do NOT introduce Postgres. Do NOT gate ingest behind Clerk/billing.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/events --isolate
cd apps/dashboard && bun run lint
```

Targeted test (`src/lib/events/normalize.test.ts`): feed representative Alertmanager,
Datadog, and generic payloads; assert each normalizes to the common schema and that two
identical payloads produce the same `dedup_hash`. Add a store test asserting upsert updates
`count`/`last_seen` rather than inserting a duplicate.

## Done criteria

- `POST /api/events/ingest` enqueues in cloud (202) and handles inline on self-host (200,
  no crash without a Queue binding).
- Consumer normalizes all three sources, dedups, and upserts into `event_log` with 30d
  retention.
- Optional re-emit goes through the SSRF-guarded proxy and is off by default.
- Inbound Events page lists + filters; normalize/store tests pass; monorepo `bun run build`
  is green.

Priority: P1 · Effort: L · Depth: E · Wave: I (Integrations) · Lever: Revenue / Ecosystem
