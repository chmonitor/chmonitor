# Doctor

Doctor tells the user whether this CLI install can talk to the dashboard and, with `--ch-host`, whether a ClickHouse HTTP endpoint is healthy. For verification, doctor also answers whether the binary is the one launch just built. <!-- pragma: allowlist secret -->

## Sub-features

- `doctor-identity` shows crate version and compile-time target (`chm --version`).
- `doctor-connectivity` runs `chm doctor` with no cluster host (CLI + dashboard checks).
- `doctor-cluster` runs `chm doctor --ch-host` (read-only scan, `readonly=2`).
- `doctor-json` prints machine-readable rows / report for CI and agents.

## How to get to it (user POV)

- Run `chm doctor`.
- Run `chm doctor --json` or `chm --json doctor`.
- Run `chm doctor --ch-host http://127.0.0.1:8123` (or set `CLICKHOUSE_HOST`, which verification **must not** inherit from the Cloud image). <!-- pragma: allowlist secret -->
- Run `chm --version` for the identity line used by the helper.

## Driving it with chm

Preconditions:

- `scripts/launch.sh` succeeded.
- Isolated `--config` (empty is fine).
- `CLICKHOUSE_HOST` is unset unless the cluster sub-feature is the one being driven. <!-- pragma: allowlist secret -->

- **Identity.** Run `.cursor/skills/verify-chmonitor/scripts/doctor.sh`. Stdout contains `ok    identity` and a version line matching `rust/ch-monitor-cli/Cargo.toml`. `$VERIFY_EVIDENCE/doctor-version.txt` matches `$VERIFY_PREFIX/bin/chm --version`.
- **Connectivity JSON.** The same command writes `doctor-connectivity.json`. `cli_version.ok` is true and `detail` contains the crate version. `base_url` is `https://dash.chmonitor.dev` unless `VERIFY_BASE_URL` was overridden.
- **Cloud healthz.** If `dashboard_health.ok` is false with `unreachable (https://dash.chmonitor.dev/api/healthz)`, treat as **informational**. Hosted `/api/healthz` is ClickHouse-gated and often 503 while `/api/v1/hosts` is 200. Do not fail identity on that row. Do not add a host to fix it. <!-- pragma: allowlist secret -->
- **Credentials.** Cloud `auth_method` is `device`. Missing bearer/api-key is expected. Do not run `chm auth login` for this feature.
- **Cluster scan.** Run `scripts/doctor.sh --cluster` when `/ping` on `$VERIFY_CH_HOST` is 200. Artifact `doctor-cluster.json` includes `score`, `grade`, `findings`. Exit 0 or 1 (critical findings). Process must not mutate the cluster.
- **Proof.** Identity file + connectivity JSON (and cluster JSON when that sub-feature ran). `scripts/redact-check.sh` must pass.

## Gotchas

- If `CLICKHOUSE_HOST` is set, `chm doctor` is a **cluster scan**, not connectivity. Always unset it for the connectivity recipe. <!-- pragma: allowlist secret -->
- `chm doctor` exits non-zero when any connectivity row fails. That is not "wrong binary".
- Cluster JSON is a `Report` object; connectivity JSON is an **array** of check rows. Do not parse them with the same schema.
- Do not put `--ch-password` or env passwords in evidence. Cluster doctor does not print the password; still avoid copying the invoking command line if it included one.
- Multi-host comma-separated `CLICKHOUSE_HOST` scans only the first host and prints a note. Verification uses a single `http://127.0.0.1:8123`. <!-- pragma: allowlist secret -->
