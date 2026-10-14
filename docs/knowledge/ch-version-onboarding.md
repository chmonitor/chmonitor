---
id: ch-version-onboarding
title: ClickHouse version onboarding audit
type: workflow
status: active
updated: 2026-10-14
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

- `ci.yml` pins every ClickHouse-backed job to `25.8`. Query configs whose
  newest `since:` variant targets 26.x never run in CI.
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

## Traps

- **The schema generator writes into the repo by default** (`--output` defaults
  to `docs/clickhouse-schemas`). Always pass a scratch `--output`.
- **The scraper silently finds nothing.** `parseChangelog` matches
  `## ClickHouse release vX.Y`, but upstream now uses
  `### <a id="269"></a> ClickHouse release 26.9`. Every `--version` prints
  `0 entries` and still exits 0.
- **`LTS_VERSIONS` lags.** `scripts/ch-schema/constants.ts` lists up to `26.3`.
  `26.8` is LTS, so the support matrix is out of date until someone adds it.
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
  This is the parser trap above.
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

## Related

- [query-config-format.md](query-config-format.md): `since:` variants
- [issue-desk.md](issue-desk.md): the desk jobs
- `docs/clickhouse-schemas/`: per-version schema notes
