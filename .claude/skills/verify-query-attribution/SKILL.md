---
name: verify-query-attribution
description: >-
  Prove chmonitor's query attribution (the leading SQL comment and the
  log_comment JSON on every dashboard query) works, in tests and on a real
  ClickHouse. Use after touching packages/clickhouse-client/src/attribution,
  adding a code path that creates a ClickHouse client, changing the
  Dashboard Usage queries, or when someone asks "why is this query not
  attributed", "who ran this query", or "is the email leaking into query_log".
---

# Verify query attribution

Background and rules: [docs/knowledge/query-attribution.md](../../../docs/knowledge/query-attribution.md).

## 1. Offline gates

```sh
cd packages/clickhouse-client && bun test src/attribution
```

- `client-coverage.test.ts` fails when a `createClient` from
  `@clickhouse/client(-web)` is not wrapped in `withQueryAttribution(`.
  Fix by wrapping the call. Add an `ALLOWED` entry only with a reason a
  reviewer can check; never to silence a real gap.
- `record.test.ts` covers the encoders: crafted values cannot break the
  comment, email never in the comment, `log_comment` size cap.
- `scope.test.ts` covers the wrapper: per-request scope, readonly fallback,
  command not retried, demo host anonymous, query cache, forged comment in
  user SQL, email absent from the query text after the fallback.

## 2. Real ClickHouse

The script starts nothing. Point it at a scratch server, never at a customer
cluster you do not own:

```sh
CLICKHOUSE_HOST=http://127.0.0.1:<port> CLICKHOUSE_USER=default \
CLICKHOUSE_PASSWORD= bun scripts/verify-query-attribution.ts
```

For a scratch server, run `/usr/bin/clickhouse server` with your own
`config.xml` (free `http_port`/`tcp_port`, a `<path>` in your scratch dir,
a `<query_log>` section). Add a second user whose profile has
`<readonly>1</readonly><max_execution_time>60</max_execution_time>` to
exercise the comment-only path: the run must end `OK` with the NOTE that
`log_comment` is empty.

Negative control: `CHM_QUERY_ATTRIBUTION=false` must make the script fail
on `comment user and source`. A pass there means the script checks nothing.

## 3. Report

Quote the PASS/FAIL lines and the ClickHouse version. Name the user profile
(default or readonly=1) each run used.
