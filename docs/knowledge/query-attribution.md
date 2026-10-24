---
id: query-attribution
title: Query attribution
type: spec
status: active
updated: 2026-10-24
tags:
  - clickhouse
  - query-log
  - audit
  - verification
  - testing
related:
  - query-config-format
  - cloud-saas-mode
  - pstack-validation
---

# Query attribution

Every query the dashboard sends to ClickHouse says who sent it and why, so
`system.query_log` can answer audit and usage questions (issues #4164,
#4165, #4174, #4178). The code is `packages/clickhouse-client/src/attribution/`.

## Carriers

One `AttributionRecord` (`record.ts`) is written into two places.

| Carrier | Shape | Read back with |
|---|---|---|
| `log_comment` setting (primary) | `{"app":"chmonitor","v":1,"version":…,"user":…,"host":…,"source":…}` plus optional `page`, `label`, `email`; at most 1024 UTF-8 bytes | `JSONExtractString(log_comment, 'user')` |
| Leading SQL comment (on by default) | `/* {"client":"clickhouse-monitoring","app":"chmonitor","v":1,"version":…,"user":…,"source":…,"host":…,"label":…} */` and a newline | the start of `query_log.query`, `system.processes`, server logs |

The SQL comment replaces the fixed minimal `QUERY_COMMENT`
(`/* {"client":"clickhouse-monitoring"} */`) and keeps its `client` key, so
existing self-filters on that fingerprint still match. `log_comment` has no
`client` key. Match it on `app = 'chmonitor'`.

## Rules

- **One scope per request.** `scope.ts` keeps the principal and `source` in
  `AsyncLocalStorage`. `withQueryAttribution` wraps a client's `query()` and
  `command()` and stamps each call from the scope it runs in, so one pooled
  client serves many users correctly.
- **Safe character set.** Every value in the SQL comment is reduced to
  `[A-Za-z0-9._:/=,+-]`, at most 64 characters. No `*`, quote, backslash, or
  whitespace can appear, so a user or source containing `*/` cannot close the
  comment. A forged attribution comment in the caller's SQL stays in the body;
  the real one is always first.
- **Email.** Off unless `CHM_QUERY_ATTRIBUTION_INCLUDE_EMAIL=true`, and then
  only in `log_comment`. Never in the SQL comment. The `user` field is cut at
  `@`, so an email-shaped subject does not leak through it either.
- **Demo hosts.** In cloud mode the env hosts are a public demo whose
  `query_log` every visitor can read. `getClient` passes
  `{ anonymous: isEnvHostDemo }`, so the record has `user: null`, no email,
  and the principal is never resolved.
- **`readonly = 1` profiles** refuse any changed setting, `log_comment`
  included (code 164). A refused `query()` is resent once with the SQL comment
  only, and the client stays in comment-only mode. A refused `command()` is
  not resent, because a command is not idempotent; the next call uses the
  comment only.
- **Query cache.** A cached query (`use_query_cache=1`) leaves `log_comment`
  out when the SQL comment carries the record, so users share one cache entry.
- **Shared edge cache.** The SQL shown in the dashboard (`displaySql`) always
  has `user: null`.
- **Config.** `CHM_QUERY_ATTRIBUTION` (default on),
  `CHM_QUERY_ATTRIBUTION_SQL_COMMENT` (default on),
  `CHM_QUERY_ATTRIBUTION_INCLUDE_EMAIL` (default off),
  `CHM_QUERY_ATTRIBUTION_LABEL`.

## Coverage guard

`packages/clickhouse-client/src/attribution/__tests__/client-coverage.test.ts`
scans `apps/dashboard/src` and `packages` for every `createClient` imported
from `@clickhouse/client` or `@clickhouse/client-web`, including aliased,
namespace, and dynamic imports. Each call must be written as
`withQueryAttribution(createClient(...), …)`, or its file must be in the
`ALLOWED` map with a reason. A stale allowlist entry also fails. A client
only exists through that factory, so this covers every `.query()`,
`.command()`, `.exec()`, and `.insert()` sent through one.

Current allowlist:

- `clickhouse-client.ts` picks the factory at runtime and wraps the result
  before pooling.
- `scripts/verify-readonly-mode.ts` is a manual probe of raw readonly
  behaviour.
- `routes/api/v1/browser-connections/test.ts` is a **known gap**: "Test
  connection" sends `SELECT version()` unattributed.

Not covered by the guard: the state backend
(`apps/dashboard/src/lib/state-backend/clickhouse-client.ts`) talks to the
app's own metadata ClickHouse over raw `fetch`, not to a monitored cluster.

## Real-server check

`bun scripts/verify-query-attribution.ts` with `CLICKHOUSE_HOST`,
`CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` sends one query through `getClient`
inside a scope, then polls `system.query_log` by `query_id` for up to 15 s.
It never runs `SYSTEM FLUSH LOGS`, which is not ours to run on a customer
cluster. It checks that the query starts with the comment
(`client = clickhouse-monitoring`, expected user and source) and that
`log_comment` parses with `app = chmonitor`, `v = 1`, and the same user and
source. An empty `log_comment` is reported as the `readonly = 1` path.

A `readonly = 1` user only works when its profile already sets
`max_execution_time` to the value the client sends
(`CLICKHOUSE_MAX_EXECUTION_TIME`, default 60). Otherwise the client-level
setting is refused with code 164 before attribution matters.

## How Dashboard Usage reads it

`apps/dashboard/src/lib/query-config/queries/dashboard-usage.ts` picks one
record per row with `ATTRIBUTION_JSON`: `log_comment` when
`JSONExtractString(log_comment, 'app') = 'chmonitor'`, else the JSON
extracted from the leading comment. Fields come from
`JSONExtractString(ATTRIBUTION_JSON, key)`. The email column reads
`log_comment` only, since the comment never has one. Bump `v` in `record.ts`
when a field changes meaning; this page reads it.
