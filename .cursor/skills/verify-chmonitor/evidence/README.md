# Evidence dumps (not committed)

Runtime proof files for a verification run belong in `$VERIFY_EVIDENCE`
(default `/tmp/verify-chmonitor/evidence/<run-id>`), never in this folder.

`scripts/cleanup.sh` deletes scratch config/credentials and tmux sessions.
It must not delete `$VERIFY_EVIDENCE`. After cleanup, confirm the artifacts
still exist at that path.

Never copy a `credentials` sidecar or `CLICKHOUSE_PASSWORD` into evidence. <!-- pragma: allowlist secret -->
Run `scripts/redact-check.sh` before treating a dump as publishable.
