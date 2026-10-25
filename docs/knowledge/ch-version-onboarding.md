---
id: ch-version-onboarding
title: ClickHouse version onboarding audit
type: workflow
status: active
updated: 2026-10-25
tags:
  - clickhouse
  - versions
  - query-config
  - herdr
related:
  - query-config-format
  - issue-desk
---

# ClickHouse version onboarding

When ClickHouse ships a release, check each system-table column our query
configs read and file one issue per config that breaks. This is a repeatable
audit. It runs as the `local:ch-version` desk job (`52 4 1,15 * *`,
playbook `docs/herdr-desk/ch-version.md`) and as the
`ch-version-onboarding` Claude skill.

## Why

- CI runs the query configs on two versions only (`test-queries-config` in
  `test.yml`: `25.8` and `26.8`; `ci.yml` stays on `25.8`). A `since:` variant
  for any other version never runs in CI.
- A system table can rename a column, retype it, or move it behind a config.
  The page then shows an error card for every user on that version.
- The changelog scraper (`scripts/build-ch-schema-docs.ts`) is a cross-check
  and does not decide anything. The real test is to run the configs against the
  official binary.

## Method in one paragraph

Download the official `clickhouse-common-static` tarball for the baseline (the
newest `docs/clickhouse-schemas/v*.md`) and for the new release, and verify the
sha512. Diff `system.columns` for every table that `apps/dashboard/src/lib/query-config/**`
references. Then `EXPLAIN PLAN` each config's applicable SQL on both binaries.
A failure on the new binary only is a regression and needs a `since:` variant.
A failure on both is a config bug. File one issue for each.

## Run the query audit

`scripts/audit-query-configs.ts` runs the `EXPLAIN PLAN` step across many
versions in one command. It covers every registered `QueryConfig` and every
chart builder in `chart-registry.ts`.

```sh
# one official clickhouse-common-static binary per version you want covered
bun scripts/audit-query-configs.ts \
  --bin chbins/23.3/clickhouse --bin chbins/25.8/clickhouse --bin chbins/26.9/clickhouse \
  --json audit.json          # optional: full error text per cell
# --only <substring> narrows to matching ids, --all prints passing rows too
```

For each binary it starts a throwaway `clickhouse server` (one at a time,
ports from 19100, or from `CHM_AUDIT_PORT` so parallel runs do not collide) with every system log and an embedded Keeper enabled. It
runs `SYSTEM FLUSH LOGS` so the `*_log` tables exist, and stops the server when
done. It does not use `clickhouse local`, because local never creates log
tables. Each query gets the variant that `selectVersionedSql` picks for the
server's `version()`. The query is sent with its `defaultParams` and
`clickhouseSettings`. The script prints a status × version count table, every
row that is not `ok` on some version, and the first line of each error. It
exits 1 when any cell is `defect` or `other`. One binary takes about 8 seconds.

| Cell | Meaning |
|---|---|
| `ok` | plans |
| `defect` | wrong SQL for that version: unknown column or function, a type error, syntax |
| `gated` | optional query whose table or `columnCheck` column is missing. The app hides it, so it is not checked |
| `absent` | non-optional query whose table is missing. The page errors on that version, unless the table needs setup a bare server lacks |
| `harness` | error caused by a placeholder value the script made up, such as an empty host |
| `other` | anything else. Read it |

Limits: kafka, rabbitmq, and replicated or distributed tables have no rows on
a bare server. A log table that never got an entry (`latency_log`,
`crash_log`) may not be created. Those configs show as `gated` or `absent`,
not `ok`. `opentelemetry_span_log` gets an explicit `partition_by`, because on
23.x its default key names a missing column and `SYSTEM FLUSH LOGS` hangs.
The script sends each query with its config's settings, but not with the
settings the app adds itself (`session_timezone`, the query-cache knobs,
`max_execution_time`, the row cap). `EXPLAIN PLAN` catches unknown columns and
type errors. It does not catch errors that only show at run time, such as a
bad cast on real data.

## Traps

- **The schema generator writes into the repo by default** (`--output` defaults
  to `docs/clickhouse-schemas`). Always pass a scratch `--output`.
- **The scraper depends on the changelog heading format.** Upstream moved from
  `## ClickHouse release vX.Y` to `### <a id="269"></a> ClickHouse release 26.9`
  and the scraper found nothing until #3880. It now parses both and exits 1 on
  0 entries; a new heading format will fail it again.
- **`clickhouse local` reads stdin.** Started from a script without `< /dev/null`,
  it fails every query with `CANNOT_DETECT_FORMAT`.
- **`*_log` tables are absent in `clickhouse local`**, and so are keeper, kafka,
  and rabbitmq. A bare `clickhouse server` with no config file has none of the
  log tables either. Report these configs as skipped. Do not count them as OK.
- **The environment has `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD` set**, so
  `clickhouse client` against a scratch server fails authentication. Run it
  with `env -u CLICKHOUSE_USER -u CLICKHOUSE_PASSWORD … --user default`.
- **A retype is usually not a break.** `processes.interface` changed from
  `UInt8` to `Enum8` in 26.9, and `running-queries.tsx`'s `interface = 1` still
  works. Prove a break with a `SELECT` before you file it.

## First dry run (2026-10-14)

- Newest stable: `v26.9.18.11-stable`. Newest LTS: `v26.8.26.12-lts`.
- Newest schema doc: `v26.6.md`.
- Step 3 scrape: `Filtered to version 26.9: 0 entries`, and the same for 26.8.
  This was the parser trap above, fixed since in #3880.
- **Column diff 26.6.8.7 → 26.9.18.11** (server `system.columns`, 66 referenced tables):
  - Added: `asynchronous_metrics.key_values`, `mutations.finish_time`,
    `parts.part_storage_type`, `parts_columns.estimates.default_count`,
    `projection_parts.files`, `tables.skipping_indices_types`,
    `users.auth_grants`.
  - Removed: none.
  - Retyped:
    - `processes.interface` and `processes.http_method`: `UInt8` to `Enum8`.
      No break.
    - `settings.tier`, `merge_tree_settings.tier` and
      `replicated_merge_tree_settings.tier`: the enum gains `PrivatePreview`.
    - `users.valid_until`: `Array(DateTime)` to `Array(DateTime64(0))`.
- **EXPLAIN PLAN over 121 registered configs**, on each of 25.8.33.6, 26.5.1 and 26.9.18.11:
  - The same 8 configs fail on all three versions with an unknown column. These
    are config bugs and not 26.9 regressions:
    - `scheduler`: `status`, `in_flight_*`. The table has `inflight_*` and no `status`.
    - `workloads`: `priority`.
    - `histogram-metrics`: `count`.
    - `asynchronous-inserts`: `total_rows`.
    - `dictionaries`: `hierarchical`.
    - `query-condition-cache`: `key`.
    - `kafka-consumers`: `last_exception_time` on 25.8, `num_commit_failures` on 26.x.
    - `background-schedule-pool`: `task_name`. It fails on 26.x. On 25.8 the table is absent, so the check
      was skipped.
  - `part-info`: the `since: '26.1'` variant calls `length(files)`, but
    `system.parts.files` is `UInt64`. It fails on 26.x and the 25.8 variant is
    fine.
  - 46 to 52 configs were skipped, depending on the version, because their
    tables are absent in `clickhouse local`. They include every `query_log`,
    `part_log` and `text_log` view.

## 26.10 run (2026-10-25)

- Newest stable: `v26.10.2.103-stable` (2026-10-24). Newest LTS: `v26.8.34.13-lts`,
  already in `LTS_VERSIONS` and in the `test-queries-config` matrix. Baseline: 26.9.25.15.
- Changelog scrape: 1 version doc and 16 table docs, but noisy (column names
  parsed as `unknown` and `to`, a fake `stopping → receive` rename). The
  committed `docs/clickhouse-schemas/v26.10.md` is written from the binary diff instead.
- **Column diff 26.9.25.15 → 26.10.2.103** (server with log tables, 77 referenced tables):
  - Added: `query_log.used_number_of_joins`, `used_join_algorithms`,
    `used_join_kinds`, `used_join_strictness`, `spilled_to_disk`;
    `processes.spillable_memory_bytes`; `clusters.replica_group`;
    `dictionaries.is_lazy`; `errors`/`error_log.last_error_lines`,
    `last_error_symbols`; four `scheduler` columns; quota `written_rows` columns.
  - Removed: ten `query_metric_log.ProfileEvent_*` columns. None is referenced.
  - Retyped: enum or tuple extensions only (`interface`, `op_num`,
    `blob_storage_log.event_type`, `grants.access_type`, `*_tid`,
    `transaction_id`). No config filters on them.
- **Query audit** over 371 queries (configs + chart builders), with
  `enable_analyzer` 0 and 1, both as `EXPLAIN PLAN` and executed: 355 ok on
  26.10, 0 defects, 11 gated, 5 harness. No `since:` variant needed.
- 26.10 accepts `enable_analyzer = 0` but ignores it (`getSetting` returns
  `true`); 26.9 rejects `allow_experimental_analyzer = 0`. The audit script
  does not drop analyzer-off settings the way the app does (#3984), so
  `tables-overview` shows `other` on 26.9 in the audit only.
- Trap: `scripts/build-support-matrix.ts` also writes
  `docs/versions/v0.3/reference/support-matrix.mdx`, a directory the repo no
  longer has. Delete it after running the generator.

## Related

- [query-config-format.md](query-config-format.md): `since:` variants
- [issue-desk.md](issue-desk.md): the desk jobs
- `docs/clickhouse-schemas/`: per-version schema notes
