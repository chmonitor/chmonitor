# Evidence

Runtime dumps default to `$VERIFY_EVIDENCE` (often
`/tmp/verify-chmonitor/evidence/<run-id>`). `scripts/cleanup.sh` never
deletes that directory. After cleanup, confirm the artifacts still exist.

The canonical proven drive (`local-connections`) is committed here as
`local-connections/` — redacted transcripts/JSON only. Never commit a
`credentials` sidecar or `CLICKHOUSE_PASSWORD`. <!-- pragma: allowlist secret -->
`last-run/` is gitignored for ad-hoc dumps.

Run `scripts/redact-check.sh` before treating a dump as publishable.
