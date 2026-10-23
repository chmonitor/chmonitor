---
id: alerting-validation
title: Alerting validation lever
type: workflow
status: active
updated: 2026-10-23
tags:
  - alerting
  - health
  - webhooks
  - verification
  - testing
related:
  - pstack-validation
  - metadata-db-optional-config
  - query-config-format
---

# Alerting validation lever

`bun scripts/verify-alerting.ts` (or `pnpm run verify:alerting`) checks the
alerting pipeline end to end on the current checkout. It exits non-zero at
the first failing step. It needs `/usr/bin/clickhouse` (override with
`CHM_VERIFY_CLICKHOUSE_BIN`) and `openssl`. To use a server you already run,
set `CHM_VERIFY_CLICKHOUSE_URL`. The lever only reads from that server and
skips the warm-up writes it makes on the scratch server, so an optional log
table that does not exist there shows as `skip`.

## When to run it

Run it before you open a PR that touches any of these:

- `apps/dashboard/src/lib/alerting/**`, which holds the builtin rules, compound
  rules and rule registry
- `apps/dashboard/src/lib/health/adapters/**`, the channel message builders
- `apps/dashboard/src/lib/health/sweep/**`, which covers rule execution,
  batching, suppression and dispatch
- alert routing (`alert-routing.ts`), channel providers (`*-dispatch.ts`),
  custom webhook targets, or any rule or diagnostic SQL

Per-PR checks miss three things: a full `pnpm run build`, rule SQL after a
batching change, and real dispatch to every channel. In October 2026 four
alerting PRs (#4141 to #4144) merged without any of these. The lever covers
them.

## What each step proves

| Step | Proves | Does not prove |
| --- | --- | --- |
| 1. Scratch ClickHouse | A real server starts on free ports, with every optional log table enabled, so optional rules run instead of skipping. | Behaviour on older ClickHouse versions; only the local binary's version is tested. |
| 2. Rule SQL | Every `BUILTIN_RULES` SQL, every remediation diagnostic, and the batched `UNION ALL` statement parse and run under `readonly=1` with `enable_analyzer=0` and `=1`. The batch is built by `buildBatchedKpiSql(partitionRulesForSweep(...).batched)`, the same as the sweep, once for default-enabled rules and once with all rules opted in. It also runs the `mv-refresh-staleness` and `slow-query-regression` helper SQL. Before the loop, the script checks that `getSetting('enable_analyzer')` returns each value. A rule whose optional table is missing prints `skip`, never `ok`. | The values are right, or the thresholds fit; the server is empty, so most counts are 0. It does not cover operator custom rules (D1) or the PeerDB alert cycle, which queries PeerDB and not ClickHouse. |
| 3. Delivery | The real `createDispatcher` sends a firing, a reminder and a recovery to a local HTTPS capture server. The targets are webhook routes (auto/generic, Slack URL, Discord, Teams, Google Chat), custom targets (`auto`, `raw`, `slack`, `matrix`, `hookshot`), a native Matrix route and an ntfy route. For each request the script checks: one request per target per tick; the method (Matrix uses PUT); the Matrix path `/_matrix/client/v3/rooms/%21…%3A…/send/m.room.message/<txn>` with a different txn on each send; the token only in `Authorization`; a JSON body (ntfy is plain text, with its title in a header); and the severity or recovery word, the host, and the dashboard link. Any send to a URL outside the capture server is blocked and fails the run, so local `.env` or declarative config cannot page a real channel. | That a real Slack, Discord, Teams or Google Chat server accepts the body. Email, Telegram, PagerDuty, Opsgenie, Pushover and Twilio are not driven. |
| 4. Focused suites | `bun test src/lib/alerting src/lib/health/adapters src/lib/health/sweep` and `tests/repo/docs-data-sync.test.ts` pass. | The full suite, `tests/agent`, or the build. Run those separately (see below). |

How the delivery step reaches the capture server:

- **SSRF escape hatch.** The step sets `CHM_ALLOW_PRIVATE_HOSTS=true`, the
  self-host opt-in, and first clears `CHM_CLOUD_MODE` and
  `CHM_DEPLOYMENT_MODE`, because cloud mode forces the flag off. The script
  asserts that `resolveConfig` reports `allowPrivateHosts` before it sends
  anything. Native Matrix, ntfy and custom targets go through
  `validateHostUrl` at send time, and this flag is what lets the loopback
  capture server pass.
- **Format selection by URL.** Discord, Teams, Google Chat and Slack are
  detected from the URL, and the adapters match the provider hostname
  anywhere in the URL. So a path such as
  `https://127.0.0.1:P/t/x//discord.com/api/webhooks/1/x` selects the real
  adapter. The script asserts `detectAdapter()` for each one before it
  dispatches.

**Known gap, kept as a pinned list.** The one-line `{ text, content }`
wrapper has no dashboard link. Plain and Slack-URL webhook routes without the
Slack app use it for firing and recovery, and `auto` custom targets use it on
every tick. The pinned list in the script (`KNOWN_LINKLESS`) records which
sends have this gap, and the code path predates #4141. #4141's
`message-completeness.test.ts` checks the adapter builders, not this wrapper.
If a listed send gains the link, the step fails, so the list cannot go stale.

## Rules that go with it

- **Analyzer 0 and 1.** Run any new or changed rule SQL under both
  `enable_analyzer` values. The lever does this. For a one-off query, use
  `clickhouse local` with `SET enable_analyzer=0|1`.
- **Fail-on-old-code proof.** Run each new regression test against the code
  from before the fix and show it fails, before you rely on it. A test that
  passes on both versions proves nothing (see AGENTS.md).
- **Independent security review.** A change that touches tokens, URLs, SSRF
  guards, redirects or `Authorization` handling needs a read-only review from
  an agent that did not write it. Examples: Matrix access tokens, ntfy
  tokens, custom target secret headers, `validateHostUrl` callers. Keep
  auto-merge off until the review is back.
- **Full build and suite after a merge wave.** Run `cd apps/dashboard && pnpm
  run build` once. The root `pnpm run build` is a turbo no-op for the
  dashboard. Then run `cd apps/dashboard && bun test src/ --isolate` and
  `bun test tests/repo tests/agent` from the root. Compare the failing test
  names against the commit before the wave. Re-run each new failure on its
  own to tell a load timeout from a real regression.

## Known pre-existing full-suite failures

On 2026-10-23 no test failed on both `67be9376c`, the commit before the
alerting wave, and `de1c26cd5`, after it. Each commit ran `bun test src/
--isolate` once on a loaded host, plus `tests/repo tests/agent`.

The run at `de1c26cd5` failed one test: `AreaChart log scale > data with zero
values still renders one continuous fill path`
(`components/charts/primitives/area-log-scale.test.tsx`). It hit the 5000 ms
timeout and passes when run alone. Treat it as a load timeout, not a
regression.

Add a test here only if it fails on both sides of a wave. Re-run any other
failure alone before you call it flaky.
