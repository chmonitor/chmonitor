# 42 — Kafka Consumer Control (gated pause/resume/offset via SSRF-guarded broker admin proxy)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If a STOP condition
> occurs, stop and report — do not improvise. When done, update this plan's status
> row in `plans/README.md`.

## Kickoff prompt

```text
Execute plans/42-kafka-consumer-control.md ALONE (Wave I, integrations).
Goal: turn the read-only Kafka UI into a gated control surface — pause/resume a
consumer group and reset its offsets — only when an admin broker is explicitly
configured. Invariants you MUST hold:
- Self-hosted/OSS stays whole; the feature is OFF by default and fails open
  (no admin env ⇒ read-only UI exactly as today, no 500s).
- Controls are DESTRUCTIVE ops → keep them ACK-gated (confirm dialog) and
  auth-gated (server route), and AUDIT every action (who/what/when/result).
- New outbound (broker admin) MUST route through the existing SSRF guard
  (createHostValidationFetch / host-validation), same as user-connections.
- Honest claims: controls render ONLY when KAFKA_ADMIN_BROKER is set; otherwise
  the endpoint returns 403 and the UI shows read-only state.
- Postgres/multi-DB: NO. Do not add a DB backend.
Files: routes/(dashboard)/kafka-consumers.tsx, new
routes/api/v1/kafka/consumers/$group.ts, SSRF-guarded broker admin client, env
KAFKA_ADMIN_BROKER. End by running: cd apps/dashboard && bun run type-check &&
bun run build && bun test src/lib/kafka --isolate && bun run lint.
```

## Current reality (audited)

Per ROADMAP §2 (Integrations) and §4 spec 42: the Kafka UI is **read-only** today —
it shows consumer groups, lag, and members but exposes no control affordances. Ops
teams routinely need to **pause/resume** a stuck consumer or **reset offsets** after a
bad deploy, and today they must drop to `kafka-consumer-groups.sh` on a bastion. The
read path already exists; this plan adds a *conditional, audited* control path.

Pointers (confirm exact paths with `rg`, mark `(verify)` if they differ):
- `apps/dashboard/src/routes/(dashboard)/kafka-consumers.tsx` — the read-only page. (verify)
- Existing Kafka read client / data loader under `src/lib/kafka/` or an integrations
  dir — reuse its broker connection config for the read side. (verify)
- SSRF guard: `createHostValidationFetch` / host-validation helper already used by
  `routes/api/v1/user-connections.ts` and the browser-connection proxy. Reuse it. (verify)
- Audit sink: reuse whatever plan 22 (`audit_logs` / `lib/audit/logEvent`) lands, if
  present; otherwise write a structured `console`/log line + return the action record
  in the response so the UI can show it. Do NOT invent a new D1 table here. (verify)

## Goal

When (and only when) an operator sets `KAFKA_ADMIN_BROKER`, expose three gated,
audited consumer-group actions — **pause**, **resume**, **reset-offset** — behind an
authenticated server route that proxies to the Kafka admin API through the SSRF guard,
with a confirm (ACK) dialog in the UI. With no admin broker configured, behavior is
byte-for-byte the current read-only experience.

## Implement now (F — file-level)

### Env / feature gate

- New server env `KAFKA_ADMIN_BROKER` (host:port of the admin bootstrap broker;
  comma-list allowed). Read it in `server-*` config the same way other server-only
  secrets are read (never expose to the client bundle).
- Optional `KAFKA_ADMIN_SASL_*` / `KAFKA_ADMIN_TLS` passthrough envs for auth if the
  read client already supports them — mirror its option shape, don't reinvent.
- Derive a boolean `isKafkaAdminEnabled()` = `KAFKA_ADMIN_BROKER` is set. Export it so
  both the route (to 403 early) and a client-safe capability flag can use it.

### Broker admin client — `src/lib/kafka/admin-client.ts` (new)

Signatures (KafkaJS-style admin, adapt to the installed client):

```ts
export interface KafkaAdminAction {
  group: string
  action: 'pause' | 'resume' | 'reset-offset'
  // reset-offset only:
  topic?: string
  to?: 'earliest' | 'latest' | { partition: number; offset: string }[]
}
export interface KafkaAdminResult {
  ok: boolean
  group: string
  action: KafkaAdminAction['action']
  applied?: { topic: string; partition: number; offset: string }[]
  error?: string
}
export async function runKafkaAdminAction(a: KafkaAdminAction): Promise<KafkaAdminResult>
```

- Resolve broker(s) from `KAFKA_ADMIN_BROKER`; **validate each host through the SSRF
  guard** before connecting (reject private/link-local unless `CHM_ALLOW_PRIVATE_HOSTS`
  — mirror `user-connections` exactly). If validation fails → `{ ok:false, error }`.
- `pause`/`resume`: KafkaJS has no server-side "pause a group"; implement as the
  supported analog — for `reset-offset` use `admin.setOffsets` / `resetOffsets`; for
  pause/resume, if the installed client can't do it broker-side, **return a typed
  `not-supported` error** rather than faking it (honest claims). (verify against the
  installed Kafka client's capabilities.)
- Always `admin.disconnect()` in a `finally`.

### Server route — `routes/api/v1/kafka/consumers/$group.ts` (new)

- `POST` handler. Steps, in order:
  1. Resolve user (`resolveUserId()` / existing auth helper). Unauthenticated → 401.
  2. `if (!isKafkaAdminEnabled()) return 403` with `createApiErrorResponse` (match the
     shape used elsewhere, e.g. `conversations/$id.ts:236`) — message
     `'Kafka admin controls are not enabled on this server.'`.
  3. Parse + validate body (Zod): `{ action, topic?, to? }`; whitelist `action` to the
     three literals; reject anything else with 400.
  4. `const result = await runKafkaAdminAction({ group, ...body })`.
  5. **Audit** the attempt AND outcome: `logEvent({ user, event:'kafka.consumer.'+action,
     resource: group, action, result: result.ok ? 'ok':'error', details:{ topic, to } })`
     (or structured log if plan 22 not present).
  6. Return `result` (200 on ok, 502 on broker error with sanitized message — do not
     leak raw broker stack traces; reuse `sanitizeClickHouseError`-style helper or a
     local sanitizer). (verify)
- No `GET` here (reads stay on the existing loader).

### UI — extend `routes/(dashboard)/kafka-consumers.tsx`

- Fetch a client-safe capability flag (`kafkaAdminEnabled`) from the loader/root data;
  do NOT read the broker env in the client.
- When `!kafkaAdminEnabled`: render exactly as today (read-only). Optionally a subtle
  "Controls disabled — set `KAFKA_ADMIN_BROKER` to enable" hint.
- When enabled: per consumer-group row add a small actions menu → **Pause**, **Resume**,
  **Reset offset…**. Each opens a **confirm (ACK) dialog** stating the group, the action,
  and (for reset) the target (`earliest`/`latest`); on confirm `POST` to the route.
- Show the returned `KafkaAdminResult` (applied offsets or error) inline; refetch the
  read loader after a successful action.

### Tests — `src/lib/kafka/admin-client.test.ts` (new, Bun test)

- Mock the admin client. Assert:
  - `runKafkaAdminAction` rejects a private/link-local broker via the SSRF guard
    (returns `{ ok:false }`, never connects) when private hosts disallowed.
  - `reset-offset` calls the underlying `setOffsets`/`resetOffsets` with the mapped args.
  - `disconnect()` is always called (even on throw).
- Route test (optional, if a route-test harness exists): 403 when `KAFKA_ADMIN_BROKER`
  unset; 400 on an unknown `action`.

## STOP conditions & drift check

Drift check (run first):
`git diff --stat -- apps/dashboard/src/routes/(dashboard)/kafka-consumers.tsx apps/dashboard/src/lib/kafka` — if the read page or Kafka lib changed materially since this
plan was written, reconcile the pointers before coding.

STOP and report if:
- There is **no** existing SSRF host-validation helper to reuse (do NOT ship broker
  admin without it — that's a new unguarded outbound).
- The installed Kafka client cannot perform even offset reset server-side (then the
  whole control surface is `not-supported`; report rather than fake it).
- Enabling the route would change behavior when `KAFKA_ADMIN_BROKER` is unset (the
  OSS/self-host fail-open invariant must hold).
- More than the listed files must change (e.g. a new D1 migration is required) — the
  spec scopes this to route + client + UI + env only.

## Verification

```bash
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/kafka --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

ALL must hold:
- [ ] With `KAFKA_ADMIN_BROKER` unset: page is read-only; the route returns 403; no
      behavior change vs today (fail-open verified).
- [ ] With it set: pause/resume/reset-offset work via the route, each behind a confirm
      (ACK) dialog and each **audited** (actor/action/result recorded).
- [ ] All outbound broker connections pass through the SSRF guard; private/link-local
      hosts rejected unless explicitly allowed.
- [ ] **Safety**: no action auto-applies without the confirm dialog; the endpoint is
      auth-gated; no existing read path or query plan is altered; no destructive default.
- [ ] `type-check`, `build`, `bun test src/lib/kafka --isolate`, `lint` all exit 0.
- [ ] No files outside the listed scope modified; `plans/README.md` row updated.

---

Priority **P2** · Effort **M** · Depth **F** · Wave **I** · Lever **Adoption/Enterprise**
