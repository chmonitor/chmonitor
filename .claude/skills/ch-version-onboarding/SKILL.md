---
name: ch-version-onboarding
description: >-
  Audit chmonitor against a new ClickHouse release: diff system.columns
  between official binaries, EXPLAIN every query config on the new version,
  regenerate the support matrix, file one issue per broken config. Use when a
  ClickHouse release ships, a page errors only on a newer server, before
  bumping the CI ClickHouse version, or when adding a `since:` variant.
---

# ClickHouse version onboarding

The full procedure, with commands, is the desk playbook
[`docs/herdr-desk/ch-version.md`](../../../docs/herdr-desk/ch-version.md). The
background, traps, and the first dry run are in
[`docs/knowledge/ch-version-onboarding.md`](../../../docs/knowledge/ch-version-onboarding.md).

## Steps

1. **Detect.** Find the newest `-stable` and `-lts` tags with
   `gh api repos/ClickHouse/ClickHouse/releases`.
2. **Compare.** The baseline is the newest `docs/clickhouse-schemas/v*.md`.
   Also check that the LTS line is in `LTS_VERSIONS`
   (`scripts/ch-schema/constants.ts`).
3. **Scrape (cross-check).** Run
   `bun run scripts/build-ch-schema-docs.ts --version X.Y --output <scratch>`.
   Always pass `--output`, because the default writes into the repo. It exits
   non-zero when it parses 0 entries; that means the changelog format moved,
   not that the release is empty.
4. **Prove.** Download and sha512-check the official
   `clickhouse-common-static` tarballs. Diff `system.columns` for the tables
   that `apps/dashboard/src/lib/query-config/**` references (excluding tests),
   then `EXPLAIN PLAN` each config's applicable `since:` SQL on the baseline
   and the new binary with
   `bun scripts/audit-query-configs.ts --bin <old> --bin <new>`. It boots a
   throwaway server per binary so the `*_log` tables are covered too.
5. **Matrix.** Run `bun run scripts/build-support-matrix.ts` and read its diff.
6. **File, do not fix.** File one issue per broken config, following the
   issue → research → PR rules in `AGENTS.md`. Give the file and line, the
   column, the failing versions, and the exact command with its error. A
   failure only on the new version needs a `since:` variant. A failure on
   every version is a config bug.
7. **CI versions.** `test-queries-config` in `.github/workflows/test.yml` runs
   on `25.8` and `26.8`; the jobs in `ci.yml` stay on `25.8`. If a newer LTS
   exists, recommend adding it as a matrix leg. Do not edit workflows as part
   of the audit.

## Rules

- A retype is not a break until a `SELECT` proves it.
- Report configs skipped because their table is absent in `clickhouse local`
  (`*_log`, keeper, kafka). Never claim "no regressions" while they are
  unchecked.
- Never print credentials. Run the client with `env -u CLICKHOUSE_USER -u CLICKHOUSE_PASSWORD`.
