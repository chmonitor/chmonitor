# Desk playbook: ClickHouse version onboarding

A new ClickHouse release can rename, drop, or retype a system-table column that
a query config reads. Nothing in CI notices: `ci.yml` pins every ClickHouse job
to `25.8`, so a page that breaks on 26.9 stays green until a user reports it.
This job runs on the 1st and 15th of the month and turns a new release into a
list of broken configs, one issue each.

Background and the first dry run: `docs/knowledge/ch-version-onboarding.md`.
Skill: `.claude/skills/ch-version-onboarding/SKILL.md`.

## Rules

- **File, do not fix.** One issue per broken config, written to the
  issue → research → PR rules in `AGENTS.md`. Never edit a query config, a
  script, or `ci.yml` from this job.
- **Search before filing.** `gh issue list --state open --search "<config name>"`
  and `git log --oneline -S '<column>' -- apps/dashboard/src/lib/query-config`.
  Comment on an existing issue instead of opening a second one.
- **Never write into `docs/clickhouse-schemas/`.** The schema generator's
  default output is that directory, so always pass `--output "$RUN_TMP/…"`.
- **No change is the normal result.** If the newest release is already
  covered by a `docs/clickhouse-schemas/v*.md`, report that and stop.
- Never print `CLICKHOUSE_PASSWORD` or any other credential. The commands below
  clear the `CLICKHOUSE_*` variables from the environment before calling the client.

## 1. Newest stable and LTS

```sh
gh api 'repos/ClickHouse/ClickHouse/releases?per_page=60' \
  --jq '.[] | select(.prerelease|not) | .tag_name' \
  | sort -V -r | awk -F- '!seen[$2]++'   # newest *-stable and *-lts
```

## 2. Compare with what the repo covers

```sh
ls docs/clickhouse-schemas/v*.md | sort -V | tail -1     # newest documented
grep -n "LTS_VERSIONS" -A 10 scripts/ch-schema/constants.ts
```

The baseline is the newest documented version, not the CI pin. If the newest
LTS line (for example `26.8`) is missing from `LTS_VERSIONS`, that goes in the
report and is a finding of its own, because step 5 reads that list.

## 3. Changelog scrape (cross-check only)

```sh
RUN_TMP=$(mktemp -d)
bun run scripts/build-ch-schema-docs.ts --version <X.Y> --output "$RUN_TMP/schema"
```

Flags (from the script's `parseArgs`): `--version/-v`, `--table/-t`,
`--output/-o` (default `docs/clickhouse-schemas`), `--verbose`.

If the output says `Filtered to version X.Y: 0 entries`, the step **failed**.
It does not mean "no changes". As of 2026-10 the parser expects
`## ClickHouse release vX.Y` headings, but upstream now writes
`### <a id="269"></a> ClickHouse release 26.9`, so every version returns 0.
Check for an open issue about it and file one if none exists. Step 4 is the
source of truth either way.

## 4. Column diff and per-config check against real binaries

Download the official static binary for the baseline and for the new release,
and verify the checksum:

```sh
v=26.9.18.11; tag=v$v-stable          # or -lts
mkdir -p "$RUN_TMP/ch-$v" && cd "$RUN_TMP/ch-$v"
gh release download "$tag" -R ClickHouse/ClickHouse \
  -p "clickhouse-common-static-$v-amd64.tgz" -p "clickhouse-common-static-$v-amd64.tgz.sha512"
sha512sum -c ./*.sha512 && tar xzf ./*.tgz
# binary: $RUN_TMP/ch-$v/clickhouse-common-static-$v/usr/bin/clickhouse
```

**4a. Columns per referenced table.** Collect the system tables used by
configs (excluding tests), then diff `system.columns`. `clickhouse local`
needs no server, but stdin must be closed:

```sh
export LC_ALL=C
grep -rhoE --exclude-dir=__tests__ --exclude='*.test.ts' 'system\.[a-z_]+' \
  apps/dashboard/src/lib/query-config | sed 's/system\.//' | sort -u > "$RUN_TMP/tables"
T=$(sed "s/.*/'&'/" "$RUN_TMP/tables" | paste -sd,)
Q="SELECT table, name, type FROM system.columns WHERE database='system' AND table IN ($T) ORDER BY table, name FORMAT TSV"
"$OLD_BIN" local -q "$Q" < /dev/null > "$RUN_TMP/old.tsv"
"$NEW_BIN" local -q "$Q" < /dev/null > "$RUN_TMP/new.tsv"
comm -13 <(cut -f1,2 "$RUN_TMP/old.tsv" | sort) <(cut -f1,2 "$RUN_TMP/new.tsv" | sort)   # added
comm -23 <(cut -f1,2 "$RUN_TMP/old.tsv" | sort) <(cut -f1,2 "$RUN_TMP/new.tsv" | sort)   # REMOVED
join -t'|' <(awk -F'\t' '{print $1"."$2"|"$3}' "$RUN_TMP/old.tsv" | sort -t'|' -k1,1) \
           <(awk -F'\t' '{print $1"."$2"|"$3}' "$RUN_TMP/new.tsv" | sort -t'|' -k1,1) \
  | awk -F'|' '$2!=$3'                                                                  # retyped
```

A removed column, or a retyped one, is a candidate break. An added column is a
candidate `since:` variant. Most retypes are harmless: `UInt8 → Enum8` still
compares with `= 1`, and `T → Nullable(T)` still sums. Prove it with one
`SELECT` before you call it a break.

**4b. Plan every config's SQL on the new binary.** Use the newest `since:`
variant that applies to the target version. Replace `{name:Type}` placeholders
with `defaultValueOfTypeName('Type')::Type`, run `EXPLAIN PLAN <sql>` through
`"$BIN" local` with stdin closed, and classify each result:

| Result | Meaning |
|---|---|
| OK | plans on this version |
| `UNKNOWN_TABLE` | table absent in `clickhouse local` (`*_log`, keeper, kafka). Not covered; count it |
| `CANNOT_EXTRACT_TABLE_STRUCTURE`, `parseAddress` on `''` | harness artifact (`merge()` over absent logs, empty placeholder). Not a break |
| `Unknown expression identifier`, `Illegal type` | **candidate break.** Run the same SQL on the baseline binary and on 25.8 |

Then sort each candidate:

- **Regression:** OK on the baseline and fails on the new release. The config
  needs a `since: '<new>'` variant.
- **Broken on every version tested:** a config bug that has nothing to do with
  the release. File it anyway, and label it so it is not mistaken for a
  version break.

`*_log` tables exist only on a server that loads a config with those log
sections. The bare `clickhouse server` with no config file has none of them.
Until this job runs the server with the packaged `config.xml`, say in the
report how many configs it skipped. Never write "no regressions" while the
`query_log` configs are unchecked.

## 5. Support matrix

```sh
bun run scripts/build-support-matrix.ts
git diff --stat docs/content/reference/support-matrix.mdx
```

Read the diff and do not commit it. A change to the support matrix belongs in
the PR that onboards the version.

## 6. File issues

For each regression or broken config, file one issue with:

- **Where:** the config file and line, e.g.
  `apps/dashboard/src/lib/query-config/system/scheduler.ts:37`, plus its
  `declarative/catalog/` copy if one exists.
- **What:** the column or type, the versions it fails on, and the fix shape
  (rename, or a new `since:` variant).
- **Verify:** the exact `clickhouse local` command and its error.

## 7. CI pin

`ci.yml` pins tests to `25.8`. When the newest LTS is newer, recommend adding
it as a second matrix leg in the report. Do not edit `ci.yml` from this job.

## Report

Newest stable and LTS, the baseline, the counts (OK / skipped / artifact /
candidate), every issue you filed or commented on, and the CI-pin
recommendation.
