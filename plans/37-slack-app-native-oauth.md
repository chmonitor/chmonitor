# 37 — Native Slack app (OAuth + slash + ACK buttons)

## Kickoff prompt

```text
Execute plans/37-slack-app-native-oauth.md ALONE (do not read other plans).
Goal: ship a native Slack app for chmonitor — OAuth install, /chmonitor slash
commands (status|query|alert) with rich blocks, a Home tab summary, and alert
messages carrying an "Acknowledge" button that updates chmonitor alert state.

Invariants (do not violate):
- Self-hosted/OSS stays WHOLE and FAILS OPEN: the Slack app is optional. Absent
  Slack env/credentials the feature is simply off; no route may crash and none may
  require Clerk/billing to function for OSS.
- SSRF: outbound calls to Slack go to the fixed api.slack.com host — that's fine —
  but any URL derived from Slack payloads (e.g. response_url) must be validated as a
  Slack-owned URL before fetching, or routed through the existing SSRF guard.
- Honest claims: only wire slash subcommands you actually implement this round.
- Postgres/multi-DB: NO. Install/state storage is Cloudflare D1 only.
- Signature verification: verify Slack request signatures (X-Slack-Signature +
  timestamp) on every inbound Slack request; reject stale/invalid.

External setup required: a Slack app + manifest, OAuth client id/secret, signing
secret. Document these; do not hardcode.

When done, run the Verification block and paste the output.
```

## Current reality (audited)

Why (roadmap §4/37, P1/L/E): today chmonitor only pushes **outbound webhooks** to Slack
(the `slack.ts` adapter under `apps/dashboard/src/lib/health/adapters/`). A **native Slack
app** — OAuth, slash commands, Home tab, and interactive ACK buttons — is a headline
adoption lever and a Pro differentiator, and the ACK button is the natural front-end for the
alert-ACK state (roadmap 29). Per strategy §1, this meets teams **in Slack**, where on-call
already lives.

Pointers (verify at head):
- Existing outbound Slack adapter: `apps/dashboard/src/lib/health/adapters/slack.ts` — the
  message/block-building code is a reuse candidate for command responses and alert posts.
- Alert state / dedup store under `apps/dashboard/src/lib/health/` — the ACK button must
  write to the same state model roadmap 29 defines `(verify module)`.
- Route convention: `apps/dashboard/src/routes/api/v1/`; D1 migrations alongside the
  existing set in `apps/dashboard/wrangler.toml`.
- `@chm/clickhouse-client` for the `/chmonitor query` and `status` data.

## Goal

An installable Slack app: OAuth install persists a workspace token in D1; `/chmonitor
status|query|alert` return rich blocks within Slack's 3s ack budget; a Home tab shows a
cluster summary; and alert messages include an "Acknowledge" button that updates chmonitor
alert state (ties to roadmap 29). Everything is optional and fail-open for OSS.

## Implement now (depth E — approach + key files + open questions + external setup)

### Approach
1. **OAuth install** — `routes/api/v1/slack/oauth.ts`: start + callback. Exchange `code` for
   an access token via `oauth.v2.access`; store `{ team_id, bot_token, installed_by,
   installed_at, owner_ref }` in a D1 `slack_installations` table (encrypt/scope the token).
2. **Signature verify** — shared middleware verifying `X-Slack-Signature` + timestamp on all
   inbound Slack requests; reject if timestamp skew > 5m or signature mismatch.
3. **Slash commands** — `routes/api/v1/slack/commands.ts`: ack within 3s (return an empty
   200 or a "working…" block immediately), then post the full result to `response_url`.
   - `status` → cluster health summary (reuse health/insights data).
   - `query` → run a **read-only** query via `@chm/clickhouse-client` and render results as a
     block table; enforce a row/time cap.
   - `alert` → list currently firing alerts.
4. **Interactivity** — `routes/api/v1/slack/interactions.ts`: handle the "Acknowledge"
   button `block_actions` payload → write an ACK (actor = Slack user, duration) to alert
   state, then `chat.update` the original message to show "Acked by @user".
5. **Events / Home tab** — `routes/api/v1/slack/events.ts`: handle the `url_verification`
   challenge and `app_home_opened` → publish a Home tab view (summary + quick actions).
6. **Alert bridge** — extend the outbound Slack alert path so posts include the ACK button
   `action_id` and reference the alert's dedup key.

### Key files
- `docs/slack/manifest.yml` (new) — app manifest (scopes, slash command, interactivity URL,
  events, Home tab). Publish-ready.
- `routes/api/v1/slack/{oauth,commands,interactions,events}.ts` (new).
- `apps/dashboard/src/lib/slack/{verify-signature,blocks,install-store}.ts` (new).
- New D1 migration: `slack_installations` (+ referenced in `wrangler.toml` migrations list).
- Extend `apps/dashboard/src/lib/health/adapters/slack.ts` for ACK-button blocks.

### Open questions
- Bolt vs. raw HTTP handlers on Workers: Bolt's Node adapters are awkward on workerd —
  prefer **raw HTTP** handlers with a small verify/blocks lib unless a Workers-compatible
  Bolt receiver is already a dep `(verify package.json)`.
- Where does `owner_ref` come from at install time for OSS (no Clerk)? Define a fallback
  (single-tenant install) so OSS works.
- Slack's 3s ack constraint vs. ClickHouse query latency → confirm the deferred-response
  (`response_url`) pattern is acceptable for `query`.

### External setup (document; do not assume)
- Create a Slack app from `docs/slack/manifest.yml`; set OAuth scopes (`commands`,
  `chat:write`, `app_home`, etc.), the slash command, interactivity request URL, and event
  subscription URL to the deployed routes.
- Provide `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` via env; document
  the OAuth redirect URL.

## STOP conditions & drift check

- STOP if a Slack install store / native-app route already exists — reconcile rather than
  duplicate.
- STOP if `query` cannot be made read-only + capped through the existing client — do not
  expose an unbounded query surface to a chat command.
- DRIFT: if the ACK-state model roadmap 29 assumes isn't present yet, land a minimal ACK
  write here and note the coupling; do not invent a parallel state store.
- Do NOT require Clerk for the app to function. Do NOT skip signature verification.

## Verification

```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/slack --isolate
cd apps/dashboard && bun run lint
```

Targeted test (`src/lib/slack/verify-signature.test.ts`): assert a correctly-signed request
passes and a tampered body / stale timestamp is rejected. Add a `blocks.test.ts` asserting
the slash-command and alert-ACK block payloads are well-formed JSON with the expected
`action_id`.

## Done criteria

- OAuth install persists a token in D1; the manifest in `docs/slack/` is publish-ready.
- `/chmonitor status|query|alert` acknowledge within 3s and post rich blocks; `query` is
  read-only + capped.
- The "Acknowledge" button updates chmonitor alert state and edits the Slack message.
- Signature verification rejects invalid/stale requests; OSS runs fine with Slack env absent.
- Slack unit tests pass; monorepo `bun run build` is green.

Priority: P1 · Effort: L · Depth: E · Wave: I (Integrations) · Lever: Adoption / Revenue
