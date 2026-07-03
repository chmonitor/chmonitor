# 44 — Outbound Webhook Event Bus (subscribe by event type, HMAC-signed, retried, SSRF-guarded)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If a STOP condition
> occurs, stop and report — do not improvise. When done, update this plan's status
> row in `plans/README.md`.

## Kickoff prompt

```text
Execute plans/44-webhook-event-bus-outbound.md ALONE (Wave I, integrations).
Goal: generalize outbound webhooks from "alerts only" to a configurable bus — a
user subscribes a URL to one or more event types (findings/insights/alerts/
connections), and chmonitor delivers HMAC-signed payloads with retry/backoff and a
dead-letter log. Invariants you MUST hold:
- Self-hosted/OSS stays whole; feature fails open — no subscriptions ⇒ no behavior
  change; delivery failures never break the emitting request path.
- SSRF-guard the new outbound: every subscription URL is validated through the
  existing host-validation guard before delivery (reuse the alert webhook proxy's
  guard — do NOT add a raw fetch).
- Honest claims: only event types actually emitted are offered in the UI.
- Signed + verifiable: HMAC-SHA256 over the raw body with a per-subscription secret;
  include timestamp + signature headers so receivers can verify and dedupe.
- Postgres/multi-DB: NO new backend beyond the existing D1 store pattern.
Files: new src/lib/events/outbound-bus.ts, D1 table webhook_subscriptions, new
routes/api/v1/webhooks/subscriptions.ts (CRUD), emit hooks across
findings/insights/alerts/connections, reuse the existing SSRF guard.
End by running: cd apps/dashboard && bun run type-check && bun run build &&
bun test src/lib/events --isolate && bun run lint.
```

## Current reality (audited)

Per ROADMAP §2 and §4 spec 44: outbound webhooks fire **only for alerts** today (via
the SSRF-guarded alert webhook proxy). A configurable bus that can fire on *any* event
unlocks integrations without bespoke code per consumer. The alert delivery path already
proves the pattern (SSRF guard + adapters); this plan factors an event-type-subscribed,
signed, retried delivery layer over it.

Pointers (confirm with `rg`, mark `(verify)`):
- Existing alert webhook delivery + SSRF-guarded proxy under `src/lib/health/` (adapters,
  the generic webhook adapter, and the outbound proxy route). Reuse the guard + the
  signing/HTTP helpers. (verify)
- SSRF guard: `createHostValidationFetch` / host-validation. (verify)
- D1 store + migration pattern: `src/lib/conversation-store/d1-store.ts` +
  `db/…-migrations/`. Mirror for `webhook_subscriptions`. (verify)
- Event emission sites: the alert sweep (`evaluateAlert`), the insights engine
  (`src/lib/insights/…`), connection mutations (`routes/api/v1/user-connections.ts`).
  These are where `emit(...)` hooks go. (verify)

## Goal

A user subscribes a destination URL to a filtered set of event types; chmonitor emits
those events onto an outbound bus that delivers **HMAC-signed** payloads with
**retry/backoff**, records failures in a **dead-letter** log, and is **SSRF-guarded** —
all without touching or slowing the code paths that produce the events.

## Implement now (F — file-level)

### D1 tables (new migration)

`webhook_subscriptions`:
`id TEXT PK, user_id TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL,
event_types TEXT NOT NULL /* JSON array, e.g. ["alert.fired","finding.created"] */,
enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER, updated_at INTEGER`
(index on `user_id`).

`webhook_deliveries` (dead-letter + audit):
`id TEXT PK, subscription_id TEXT NOT NULL, event_type TEXT NOT NULL,
status TEXT NOT NULL /* 'delivered'|'failed'|'dead' */, attempts INTEGER NOT NULL,
last_status_code INTEGER, last_error TEXT, event_time INTEGER, delivered_at INTEGER`
(index on `subscription_id, event_time`).

### Event taxonomy — `src/lib/events/event-types.ts` (new)

Enumerate the emittable types as a const union so UI + validation share one source:
`'alert.fired' | 'alert.resolved' | 'finding.created' | 'insight.created' |
'connection.created' | 'connection.deleted'` (extend to match real producers — only
list ones actually wired). Export a typed `EventPayload<T>` envelope:
`{ id, type, occurred_at, host_id?, data: unknown }`.

### Bus — `src/lib/events/outbound-bus.ts` (new)

```ts
export async function emitEvent(userId: string, evt: EventPayload): Promise<void>
// look up enabled subscriptions for userId whose event_types include evt.type;
// for each, enqueue/deliver (see below). Must NEVER throw into the caller —
// wrap in try/catch; log + record dead-letter on failure. Fire-and-forget from
// the producer's perspective (do not block/slow the emitting request).

async function deliver(sub, evt): Promise<void>
// 1. SSRF-guard sub.url (reject private/link-local unless CHM_ALLOW_PRIVATE_HOSTS).
// 2. body = JSON.stringify(evt); sig = HMAC_SHA256(sub.secret, body).
// 3. POST with headers:
//    X-Chmonitor-Event: evt.type
//    X-Chmonitor-Delivery: evt.id
//    X-Chmonitor-Timestamp: <ms>
//    X-Chmonitor-Signature: sha256=<hex>
// 4. Retry on network error / 5xx / 429 with exponential backoff (e.g. 3 tries:
//    0s, 2s, 8s — bounded; do NOT retry 4xx except 429). Respect Workers time limits.
// 5. Record final outcome in webhook_deliveries (status delivered/failed/dead).
```

On Cloudflare Workers, use `ctx.waitUntil(...)` (or the existing alert-delivery
mechanism) so delivery outlives the response without blocking it. (verify the exact
mechanism the alert path uses and reuse it.)

### Emit hooks (thin, non-blocking)

At each producer, after the primary write succeeds, call `emitEvent(userId, {...})`:
- alert sweep on fire/resolve → `alert.fired` / `alert.resolved`.
- insights engine on new finding/insight → `finding.created` / `insight.created`.
- connection create/delete → `connection.created` / `connection.deleted`.
Guard each call so a bus failure cannot fail the producer (the invariant).

### Routes — `routes/api/v1/webhooks/subscriptions.ts` (new)

`GET` list (user-scoped), `POST` create (validate URL via SSRF guard **at create time**
too, generate a secret, persist), `PATCH` (enable/disable, edit event_types/url),
`DELETE`. Optional `POST /:id/test` sends a signed `ping` event so the user can verify
their receiver. All user-scoped; reuse `createApiErrorResponse`.

### UI

Add a "Webhook subscriptions" surface (in the existing integrations/health settings area,
`(verify)` best home): list subscriptions with last-delivery status, add/edit form
(URL + multi-select event types), reveal-once secret, "Send test" button, and a
recent-deliveries / dead-letter view sourced from `webhook_deliveries`.

### Tests — `src/lib/events/*.test.ts` (Bun)

- HMAC signature is computed over the exact raw body and matches an independent verify.
- SSRF guard rejects a private-host subscription URL (no POST attempted).
- Retry/backoff: a mocked 500-then-200 delivers on retry and records `attempts=2`;
  a persistent 500 records `status='dead'`.
- `emitEvent` never throws even when delivery fails (producer isolation).
- Subscription store is user-scoped (owner-guarded upsert like plan 04).

## STOP conditions & drift check

Drift check (run first):
`git diff --stat -- apps/dashboard/src/lib/health apps/dashboard/src/lib/insights apps/dashboard/src/routes/api/v1/user-connections.ts` — reconcile pointers if these changed.

STOP and report if:
- No SSRF host-validation helper exists to reuse (do not add an unguarded outbound bus).
- The alert path's delivery/`waitUntil` mechanism can't be reused for generic events
  (report before inventing a divergent one).
- Adding an emit hook would block or can throw into a producer's critical path (the
  non-blocking, fail-open invariant must hold) — fix the isolation first.
- The work needs more than the listed files (e.g. a queue consumer — that's plan 36's
  *inbound* bus; keep this one direct-delivery unless the alert path already queues).

## Verification

```bash
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/events --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

ALL must hold:
- [ ] A user can subscribe a URL to specific event types; enabled subscriptions receive
      **HMAC-signed** payloads for those events with verifiable signature + timestamp headers.
- [ ] Delivery retries with bounded backoff; persistent failures land in a dead-letter
      log surfaced in the UI.
- [ ] Every delivery is SSRF-guarded; private/link-local URLs rejected at create and send.
- [ ] Producers are unaffected: with no subscriptions there is zero behavior change, and
      a delivery failure never fails or slows the emitting request.
- [ ] **Safety**: the bus only sends; it triggers no destructive action and applies no
      DDL; subscriptions are strictly user-scoped; no plan/query path altered.
- [ ] `type-check`, `build`, `bun test src/lib/events --isolate`, `lint` all exit 0.
- [ ] No files outside scope modified; `plans/README.md` row updated.

---

Priority **P1** · Effort **M** · Depth **F** · Wave **I** · Lever **Ecosystem/Adoption**
