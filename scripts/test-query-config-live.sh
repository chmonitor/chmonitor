#!/usr/bin/env bash
# Runs the live query-config tests (the `test-queries-config` CI job) against a
# throwaway local ClickHouse, so a SQL mistake fails here and not on main.
# The job is not a required check: auto-merge does not wait for it.
#
#   scripts/test-query-config-live.sh            # whole live suite
#   scripts/test-query-config-live.sh -t unused  # extra args go to `bun test`
#
# Needs a `clickhouse` binary (CH_BIN to override) and `bun`. The server gets
# the system logs the stock image enables (query_log, part_log, metric_log, ...);
# without them every config that reads those tables is skipped and the run
# proves nothing about it.
set -euo pipefail

CH_BIN="${CH_BIN:-$(command -v clickhouse || true)}"
[ -x "$CH_BIN" ] || { echo "clickhouse binary not found (set CH_BIN)" >&2; exit 1; }

PORT="${CH_HTTP_PORT:-18123}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(mktemp -d)"
PID=""
cleanup() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  rm -rf "$DIR"
}
trap cleanup EXIT

cat >"$DIR/config.xml" <<XML
<clickhouse>
  <logger><level>warning</level><console>1</console></logger>
  <path>$DIR/data/</path><tmp_path>$DIR/tmp/</tmp_path><user_files_path>$DIR/uf/</user_files_path>
  <http_port>$PORT</http_port><tcp_port>$((PORT + 877))</tcp_port><listen_host>127.0.0.1</listen_host>
  <users><default><password></password><networks><ip>::/0</ip></networks><profile>default</profile><quota>default</quota></default></users>
  <profiles><default/></profiles><quotas><default/></quotas>
  <query_log><database>system</database><table>query_log</table><flush_interval_milliseconds>1000</flush_interval_milliseconds></query_log>
  <part_log><database>system</database><table>part_log</table><flush_interval_milliseconds>1000</flush_interval_milliseconds></part_log>
  <text_log><database>system</database><table>text_log</table><flush_interval_milliseconds>1000</flush_interval_milliseconds></text_log>
  <trace_log><database>system</database><table>trace_log</table><flush_interval_milliseconds>1000</flush_interval_milliseconds></trace_log>
  <query_thread_log><database>system</database><table>query_thread_log</table><flush_interval_milliseconds>1000</flush_interval_milliseconds></query_thread_log>
  <session_log><database>system</database><table>session_log</table><flush_interval_milliseconds>1000</flush_interval_milliseconds></session_log>
  <metric_log><database>system</database><table>metric_log</table><flush_interval_milliseconds>1000</flush_interval_milliseconds><collect_interval_milliseconds>1000</collect_interval_milliseconds></metric_log>
  <asynchronous_metric_log><database>system</database><table>asynchronous_metric_log</table><flush_interval_milliseconds>1000</flush_interval_milliseconds></asynchronous_metric_log>
</clickhouse>
XML
mkdir -p "$DIR/data" "$DIR/tmp" "$DIR/uf"

"$CH_BIN" server --config-file="$DIR/config.xml" >"$DIR/server.log" 2>&1 &
PID=$!

URL="http://127.0.0.1:$PORT"
for _ in $(seq 1 60); do
  curl -fs --max-time 2 "$URL/ping" >/dev/null 2>&1 && break
  kill -0 "$PID" 2>/dev/null || { echo "clickhouse exited early:" >&2; tail -20 "$DIR/server.log" >&2; exit 1; }
  sleep 1
done
curl -fs --max-time 2 "$URL/ping" >/dev/null || { echo "clickhouse did not become ready" >&2; exit 1; }

# The logs are created lazily by the first flush after a query has run.
curl -fs "$URL/?query=SELECT%201" >/dev/null
sleep 4
curl -fs "$URL/" --data "SYSTEM FLUSH LOGS" >/dev/null
curl -fs "$URL/?query=SELECT%20count()%20FROM%20system.query_log" >/dev/null \
  || { echo "system.query_log was not created; configs that read it would be skipped" >&2; exit 1; }

echo "ClickHouse $(curl -fs "$URL/?query=SELECT%20version()") on $URL"
cd "$ROOT/apps/dashboard"
CLICKHOUSE_HOST="$URL" CLICKHOUSE_USER=default CLICKHOUSE_PASSWORD= \
  bun test src/lib/query-config src/lib/api/__tests__/query-cache-settings-live.test.ts \
    src/lib/api/__tests__/chart-sql-live.test.ts \
    src/routes/api/v1/__tests__/registry-smoke-live.test.ts --isolate "$@"
