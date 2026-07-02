# 21 — Advisor Engine (pganalyze for ClickHouse)

> Priority: P0 · Effort: L · Risk: MED · Depends on: none (consumes existing alerting + slow-query-regression infra)
> Category: The wedge · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

Grafana, Altinity, and the built-in ClickHouse dashboards show you *that* a
cluster is unhealthy — high part counts, slow queries, merge backlog. None of
them tell a self-hosted operator *what to change*. The single most valuable thing
a ClickHouse DBA does is decide **"add a projection here, a skip index there,
reorder this ORDER BY, add PREWHERE to that query pattern"** — and today that is
tribal knowledge locked in a handful of experts' heads. pganalyze built a
$M-ARR business doing exactly this for Postgres (index advisor, per-query
regression tracking). **There is no equivalent for ClickHouse**, and ClickHouse
Cloud's own tooling structurally won't ship deep advice to self-hosters.

Everything needed to generate these recommendations is already in the cluster's
system tables. `system.query_log` has the full query text, `read_rows` vs
`result_rows` (scan efficiency), `ProfileEvents` (granule selection), and
duration. `system.parts` has per-column compression and part counts.
`system.data_skipping_indexes`, `system.projections` (or `system.tables` DDL),
`system.part_log` (merge/mutation history) round out the picture. The chmonitor
codebase *already* fingerprints queries (`lib/alerting/slow-query-regression.ts`
— `normalizeQueryFingerprint` + `buildRegressionSQL` running a P95 regression
join entirely in ClickHouse) and *already* has a declarative rule registry
(`lib/alerting/rule-registry.ts` + `builtin-rules.ts`) that runs SQL, reads a
`valueKey`, and classifies severity. The advisor is the same shape, one level up:
instead of "value crossed a threshold → alert" it is "query/table pattern matches
an antipattern → recommendation with an estimated win."

Why now: this is the wedge the whole 2026-H2 thesis rests on ("pganalyze for
ClickHouse"). It is the reason a self-hoster picks chmonitor over a Grafana
dashboard, and the reason the AI agent (Plan 10) has something concrete to
reason about instead of ad-hoc SQL. It must ship first (Wave 1).

## Goal

A declarative **Advisor Engine** that, given a host, produces a ranked list of
**typed, evidence-backed recommendations** (projection / skip-index /
partition-key / primary-key-ordering / materialized-view / PREWHERE) each with
the triggering query fingerprint(s) or table, the estimated win, and the exact
DDL to apply — **surfaced in the dashboard and callable by the agent, never
auto-applied**. Measurable outcome: on a seeded `system.query_log` + `system.parts`
fixture the engine emits ≥1 correct recommendation of each of the 6 types with a
stable JSON shape, and each recommendation links back to the `system.*` evidence
that produced it.

## Design

### Declarative advisor registry (mirror the alert registry)

Add `apps/dashboard/src/lib/advisor/` with an `AdvisorRegistry` that is a direct
sibling of `lib/alerting/rule-registry.ts`. Keep logic **data-driven, not
hard-coded** so the community can contribute advisors (project value: "less
hard-coded logic").

`advisor-registry.ts` — types + singleton registry:

```ts
export type RecommendationType =
  | 'projection' | 'skip-index' | 'partition-key'
  | 'primary-key-ordering' | 'materialized-view' | 'prewhere'

export interface AdvisorDef {
  id: string                       // stable, e.g. 'prewhere-low-selectivity-filter'
  type: RecommendationType
  title: string
  description: string
  /** Detection SQL run against system.* — returns 0..N candidate rows. */
  sql: (opts: AdvisorOpts) => string
  /** Pure: map a candidate row → a Recommendation (DDL text, win estimate). */
  buildRecommendation: (row: Record<string, unknown>, opts: AdvisorOpts) => Recommendation
  optional?: boolean               // skip if tableCheck missing
  tableCheck?: string              // e.g. 'system.query_log'
}

export interface Recommendation {
  advisorId: string
  type: RecommendationType
  target: { database: string; table: string; column?: string }
  fingerprint?: string             // normalized query fingerprint (regression tracking)
  severity: 'info' | 'suggested' | 'strong'
  estimatedWin: { metric: 'scan_rows' | 'duration_ms' | 'bytes'; factor?: number; note: string }
  ddl: string                      // the exact statement — SHOWN, never executed
  evidence: Record<string, unknown> // the raw system.* row(s) that triggered it
}
```

The registry class is a copy of `AlertRuleRegistry` (register/get/getAll/has/size)
with a `runAll(hostId)` orchestrator that: filters by `tableCheck` (reuse the
existing table-availability probe used by the sweep), runs each advisor's `sql`
via the read-only client (`readOnlyQuery` / `validatedReadOnlyQuery` from
`lib/ai/agent/tools/helpers.ts` or the shared `@chm/clickhouse-client`), maps rows
through `buildRecommendation`, and returns a flat `Recommendation[]` sorted by
severity then estimated win.

### The six built-in advisors (`lib/advisor/builtin-advisors.ts`)

All detection SQL runs **entirely in ClickHouse** (no client-side aggregation),
following the `slow-query-regression.ts` pattern. Reuse
`normalizeQueryFingerprint` from `lib/alerting/slow-query-regression.ts` for every
query-driven advisor so recommendations tie to the same fingerprints the
regression alert already tracks.

1. **PREWHERE** (`prewhere-low-selectivity-filter`): from `system.query_log`
   (`type='QueryFinish'`, `is_initial_query=1`), find fingerprints where
   `read_rows / nullIf(result_rows,0)` is high (poor filtering) and the query has
   a `WHERE` on a non-ORDER-BY column. `buildRecommendation` emits the rewritten
   query moving that predicate into `PREWHERE`; win = read_rows factor.
2. **skip-index** (`skip-index-high-scan-column`): same source, correlate
   high-scan fingerprints against `system.data_skipping_indexes` for the table —
   if a frequently-filtered column has no skip index, recommend
   `ALTER TABLE … ADD INDEX … TYPE minmax|bloom_filter GRANULARITY 4`. Pick index
   type by column type (numeric/date → minmax, string equality → bloom_filter,
   token search → tokenbf_v1), driven by a small lookup table, not per-column code.
3. **projection** (`projection-alternate-sort-order`): find fingerprints that
   sort/filter on a column that is NOT the leading `ORDER BY` key (from
   `system.tables.sorting_key`) and scan a large fraction of the table; recommend
   `ALTER TABLE … ADD PROJECTION p_<cols> (SELECT * ORDER BY <cols>)`.
4. **partition-key** (`partition-key-over-partitioning` /
   `partition-key-missing-time`): from `system.parts` grouped by table, flag
   tables with >1000 partitions (over-partitioned) or huge tables with no
   time-based `partition_key` (from `system.tables`); recommend a
   `toYYYYMM(...)` partitioning or coarser key. DDL is advisory text (partition
   key changes require a rebuild — say so explicitly).
5. **primary-key-ordering** (`order-by-cardinality-misordered`): using
   `system.parts` (rows, marks) + column cardinality estimates
   (`uniqExact`/`uniq` sampled), detect ORDER BY keys whose high-cardinality
   column precedes a low-cardinality one that is frequently filtered; recommend a
   reordered `ORDER BY` (new table + backfill — flag as rebuild).
6. **materialized-view** (`mv-repeated-rollup`): fingerprints that repeatedly run
   the same `GROUP BY` time-bucket aggregation over a raw table; recommend a
   `CREATE MATERIALIZED VIEW … TO <rollup> AS SELECT …` skeleton. Win = queries/day
   × avg duration saved.

Each advisor is ≤ ~60 lines: a SQL builder + a pure `buildRecommendation`. This
keeps every advisor independently unit-testable and community-contributable.

### Regression tracking (fingerprint history)

Reuse the existing regression machinery: when `buildRegressionSQL` surfaces a
regressed fingerprint, the advisor engine attaches any recommendations whose
`fingerprint` matches, so a regression alert can say "and here is the fix." No new
storage needed for v1 — recommendations are computed on demand from
`system.query_log` windows. (A later child plan may persist accepted/dismissed
recommendations; out of scope here.)

### Surfaces

- `apps/dashboard/src/lib/advisor/advisor-registry.ts` — registry + types.
- `apps/dashboard/src/lib/advisor/builtin-advisors.ts` — the 6 advisors + `registerBuiltinAdvisors()`.
- `apps/dashboard/src/lib/advisor/index.ts` — `runAdvisor(hostId): Promise<Recommendation[]>`.
- Route: `apps/dashboard/src/routes/api/v1/advisor.ts` (GET, host-scoped, read-only, same auth posture as the other `/api/v1/*` routes; fail-closed).
- Agent tool `suggest_optimizations` wraps `runAdvisor` (defined here, wired in Plan 10/11). New agent skill `optimization-advisor` (Plan 11) documents interpreting the output.
- Dashboard: an "Advisor" panel listing recommendations grouped by type with the DDL in a copy box and a "why" evidence disclosure. (UI is a thin read of the route; can be a follow-up child plan if time-boxed.)

## Steps

1. **(PR)** Add `lib/advisor/advisor-registry.ts` with `AdvisorDef`,
   `Recommendation`, `AdvisorRegistry` class, and the `advisorRegistry` singleton
   — pure, no ClickHouse imports. Unit-test register/get/getAll like
   `__tests__/rule-registry.test.ts`.
2. **(PR)** Add PREWHERE + skip-index advisors to `builtin-advisors.ts`
   (query_log-driven), reusing `normalizeQueryFingerprint`. Golden-SQL + pure
   `buildRecommendation` tests against seeded rows.
3. **(PR)** Add projection + materialized-view advisors (query_log + system.tables
   sorting_key). Tests as above.
4. **(PR)** Add partition-key + primary-key-ordering advisors (system.parts +
   system.tables + sampled cardinality). Tests as above.
5. **(PR)** Add `lib/advisor/index.ts` `runAdvisor(hostId)` orchestrator with
   `tableCheck` filtering and severity/win sorting; integration test against an
   in-memory fake ClickHouse client returning fixture rows for all 6 advisors.
6. **(PR)** Add read-only route `routes/api/v1/advisor.ts` + the
   `suggest_optimizations` agent tool wrapper in `lib/ai/agent/tools/`. Route test
   asserts shape + that no write path exists.
7. **(PR)** Register advisors at startup next to `registerBuiltinRules()` and
   update `plans/roadmap/README.md` status row + `docs/content/guide/ai-agent.mdx`.

> This is an `L` plan. Each numbered step above is an independently mergeable
> `≤ M` unit and maps to one PR; a child plan is "step N of Plan 21". Steps 2–4
> are parallelizable across agents once step 1 lands.

## Real test

`apps/dashboard/src/lib/advisor/__tests__/prewhere-advisor.test.ts` (fails today —
the module does not exist):

```ts
import { advisorRegistry } from '../advisor-registry'
import { registerBuiltinAdvisors } from '../builtin-advisors'

test('PREWHERE advisor recommends moving a low-selectivity filter into PREWHERE', () => {
  registerBuiltinAdvisors()
  const def = advisorRegistry.get('prewhere-low-selectivity-filter')!
  const rec = def.buildRecommendation(
    {
      fingerprint: 'select event_type from events where user_id = ?',
      database: 'analytics', table: 'events',
      filter_column: 'user_id', read_rows: 100_000_000, result_rows: 12, samples: 40,
    },
    { hostId: 0 }
  )
  expect(rec.type).toBe('prewhere')
  expect(rec.target).toEqual({ database: 'analytics', table: 'events', column: 'user_id' })
  expect(rec.ddl).toContain('PREWHERE user_id')          // rewrite, not raw WHERE
  expect(rec.ddl).not.toMatch(/\b(DROP|ALTER TABLE .* DELETE)\b/i)
  expect(rec.estimatedWin.factor).toBeGreaterThan(1)     // derived from read_rows/result_rows
  expect(rec.evidence.read_rows).toBe(100_000_000)       // links back to system.query_log row
})
```

## Verification

```
bun run test:unit --filter @chm/dashboard advisor
bun run lint
bun run build
```

## Out of scope / STOP conditions

- **NEVER auto-apply DDL.** The engine only *emits* `ddl` strings for humans/agent
  to copy. No advisor path may call `writeQuery`. Partition-key and
  primary-key-ordering recommendations MUST state they require a table rebuild.
- No new destructive control tools. Rebuild/backfill guidance is text only.
- **Self-hosted stays whole**: the advisor route and engine ship in the OSS build
  and run against self-hosted hosts unchanged; no cloud-only gate on the core
  recommendation output. Any per-tier limit (e.g. history depth) is additive and
  fails open to the full engine on OSS.
- No persistence of accepted/dismissed recommendations in v1 (separate child plan).
- Do not invent metrics ClickHouse doesn't expose (no CPU%); win estimates come
  only from `read_rows`, `result_rows`, `query_duration_ms`, part/byte counts.

## Done

- [ ] `lib/advisor/` registry + 6 built-in advisors + `runAdvisor` implemented, all data-driven.
- [ ] `routes/api/v1/advisor.ts` read-only route; no write path.
- [ ] `suggest_optimizations` agent tool wraps `runAdvisor` (consumed by Plan 10/11).
- [ ] Real test above fails on `main`, passes after; per-advisor golden-SQL + pure-builder tests green.
- [ ] `bun run lint && bun run build` green.
- [ ] Advisors registered at startup alongside `registerBuiltinRules()`.
- [ ] Status row for #21 in `plans/roadmap/README.md` flipped (`IN PROGRESS`/`IN REVIEW`/`DONE`).
- [ ] `docs/content/guide/ai-agent.mdx` updated to describe the advisor surface.
