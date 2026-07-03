# 46 — Query Advisor Engine (slow query → ranked skip-index / projection / partition / PREWHERE DDL, recommend-only)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If a STOP condition
> occurs, stop and report — do not improvise. When done, update this plan's status
> row in `plans/README.md`. This is an **epic-brief (E)** and the **strategic wedge**:
> do the discovery in "Open questions" *before* coding, then implement.

## Kickoff prompt

```text
Execute plans/46-query-advisor-engine.md ALONE (Wave AI — THE WEDGE, highest
strategic priority). Goal: build the "pganalyze for ClickHouse" advisor — given a
slow query (id or SQL) + EXPLAIN + schema, produce RANKED DDL recommendations
(skip-indexes, projections, partition keys, PREWHERE) with estimated impact and
risk. Invariants you MUST hold (non-negotiable):
- THE ADVISOR RECOMMENDS DDL AND NEVER AUTO-APPLIES. Output is ranked DDL text +
  risk + impact ONLY. No ALTER/CREATE is ever executed. No auto-apply button, no
  "apply for me" tool. This is the load-bearing safety invariant of the whole wedge.
- Recommendations must never break existing query plans: validate with EXPLAIN
  before/after where possible; if a candidate could regress other queries, say so
  in its risk field rather than suppressing it.
- Self-hosted/OSS stays whole; the advisor runs read-only against system.* and
  degrades gracefully (no crash if a system table is absent / permission-denied).
- Meter as premium usage (billing meter) via the existing AI-usage/entitlements
  path; fail open for self-host.
- Honest claims: every impact number is an ESTIMATE and labeled as such.
- SSRF-guard any new outbound (there should be none — this is CH-local + LLM).
- Postgres/multi-DB: NO.
This is depth E: resolve the open questions first, then build:
new src/lib/ai/advisor/{recommendation-engine,impact-estimator,sql-rewriter}.ts,
src/lib/ai/agent/tools/advisor-tools.ts (get_optimization_recommendations),
packages/mcp-server/src/tools/advisor.ts, routes/(dashboard)/advisor.tsx, and
advisor __tests__. End by running:
cd apps/dashboard && bun run type-check && bun run build &&
bun test src/lib/ai/advisor/__tests__ --isolate && bun run lint.
```

## Current reality (audited)

Per ROADMAP §1 (positioning) and §4 spec 46: **this is the reason to choose chmonitor
over `system.query_log` + Grafana.** Today the agent is a Tier-2 "collector + skill
guide" — 11 real tool groups, 18 skills that give projection/index guidance **in prose
only**, and deterministic insights with static thresholds (ROADMAP §2, AI advisor row).
There is **no programmatic DDL recommender**. ClickHouse Cloud's "Ask AI"/"Agents" are
Cloud-locked and analytics-first (§1) — none is an *operational advisor for self-hosted
clusters*. Closing this gap is the wedge.

Pointers (confirm with `rg`, mark `(verify)`):
- New home: `src/lib/ai/advisor/` (create). (verify — nothing there yet)
- Agent tools live in `src/lib/ai/agent/tools/` — add `advisor-tools.ts` alongside the
  existing query/storage/etc. tool groups. (verify)
- MCP server tools: `packages/mcp-server/src/tools/` — add `advisor.ts` so the advisor is
  reachable from the built-in MCP server too. (verify)
- Insights collectors (`src/lib/insights/collectors.ts`) — a model for reading `system.*`
  read-only; the advisor reads similarly. (verify)
- ClickHouse client: `@chm/clickhouse-client` — used read-only for EXPLAIN / schema /
  `system.parts` / `system.columns` / `system.query_log`. (verify)
- Optional: `rust/monitor-core` WASM if any scoring is better done there (optional; the
  spec says "optionally reuse"). (verify)

## Goal

Given a slow query (by `query_id` from `system.query_log`, or raw SQL) plus its EXPLAIN
plan and the table schema, the engine scores candidate optimizations across four
ClickHouse-specific techniques, ranks them by estimated granules/bytes saved, and emits
**ranked DDL text + risk + effort + estimated impact** — surfaced via an agent tool, an
MCP tool, and an `/advisor` page. It **recommends only**; nothing is applied.

## Implement now (E — approach + key files + heuristics + open questions)

### Inputs the engine gathers (all read-only)

- The query: raw SQL (given) or resolved from `system.query_log` by `query_id`
  (text, `read_rows`, `read_bytes`, `memory_usage`, duration).
- `EXPLAIN indexes = 1` / `EXPLAIN PLAN` / `EXPLAIN ESTIMATE` for the query → granules
  scanned, parts, index usage, PREWHERE presence.
- Schema for referenced tables: `CREATE TABLE` (engine, ORDER BY / primary key,
  PARTITION BY, existing skip-indexes/projections), plus `system.columns`
  (per-column compressed/uncompressed size, type), `system.parts` (active parts, rows,
  bytes) for the target table.

### Scoring heuristics (spell these out in code; each candidate carries an estimate)

Implement one scorer per technique in `recommendation-engine.ts`, each returning a
`Recommendation { kind, ddl, rationale, estImpact, risk, effort }`:

- **Skip-index** — recommend `ALTER TABLE … ADD INDEX … TYPE {minmax|set|bloom_filter} …
  GRANULARITY g` when a query has a **selective predicate on a column that is NOT a
  prefix of the sorting/primary key** (so the sparse PK index can't prune it). Score by
  the predicate's **selectivity off the PK prefix**: estimate fraction of granules the
  skip-index could skip = `1 − selectivity`; impact = granules/bytes saved. Pick index
  type by predicate shape (equality/IN → `set`/`bloom_filter`; range → `minmax`).
- **Projection** — recommend `ALTER TABLE … ADD PROJECTION … (SELECT … GROUP BY / ORDER
  BY …)` when the query's **GROUP BY or ORDER BY mismatches the table ORDER BY** (so the
  base part ordering forces a full scan/sort). Score by the cost of the mismatched
  sort/aggregate vs. serving it from a projection whose ORDER BY matches the query.
- **Partition key** — recommend a PARTITION BY change (as a **rebuild recommendation**,
  clearly marked high-effort/high-risk since it can't be `ALTER`ed in place) when there
  is a **range filter on a non-partition column** (typically time) that currently prunes
  no parts. Score by parts skippable if that column were the partition key.
- **PREWHERE** — recommend moving a **selective column predicate into PREWHERE** (query
  rewrite via `sql-rewriter.ts`, not DDL) when a highly selective condition sits in
  WHERE and the column is cheap to read; impact = rows filtered before reading wide
  columns. This is the one "no DDL" recommendation — a rewrite suggestion.

**Ranking:** normalize each candidate's estimate to **estimated granules (and bytes)
saved** and sort descending; break ties by lower risk/effort. Target: produce at least
one actionable recommendation for **>70%** of analyzed slow queries (the accept bar).

### Impact estimation — `impact-estimator.ts`

- Combine EXPLAIN granule/part counts with `system.columns` sizes to translate
  "granules saved" → "bytes read saved" → a rough time delta. Everything is an
  **estimate**, labeled as such (honest claims). Where feasible, run `EXPLAIN` on a
  **candidate rewrite** (for PREWHERE) to show before/after granules — this is the
  "validate no plan breakage" evidence. DDL candidates that can't be safely simulated
  carry a risk note instead of a false-precision number.

### SQL rewriter — `sql-rewriter.ts`

- Only for the PREWHERE recommendation (and any read-only rewrite the engine suggests).
  Produces a rewritten SELECT for the user to review; **never executes it** beyond an
  optional `EXPLAIN` to measure impact.

### Recommend-only + billing (both mandatory)

- The output type is **ranked DDL strings + risk + effort + estimated impact**. There is
  **no execution path** — do not add an "apply" tool/endpoint/button anywhere. (Contrast
  the ACK-gated *control* tools, which are a different, env-gated surface.)
- Each advisor invocation **meters as premium AI usage** through the existing usage/
  entitlements path (mirror how agent generations meter; wire `addAiSpend`/usage the same
  way plan 14 describes). Fail open for self-host (no Clerk ⇒ not metered, still works).

### Surfaces

- Agent tool `src/lib/ai/agent/tools/advisor-tools.ts` →
  `get_optimization_recommendations({ query_id? | sql?, host? })` returning the ranked
  recommendations (structured), so the agent can present them in chat.
- MCP tool `packages/mcp-server/src/tools/advisor.ts` exposing the same, for external MCP
  clients.
- `routes/(dashboard)/advisor.tsx` — a page: paste SQL or pick a slow query from
  `query_log`, run analysis, show the ranked cards (DDL, estimated impact, risk, effort,
  a "copy DDL" button — **copy, not apply**).

### Tests — `src/lib/ai/advisor/__tests__/*.test.ts` (Bun)

Use fixtures (mock EXPLAIN output + `system.columns`/`parts` + a query). Assert:
- A selective non-PK-prefix predicate yields a **skip-index** recommendation with the
  right index type and a granules-saved estimate.
- A GROUP BY/ORDER BY mismatch yields a **projection** recommendation.
- A time range filter on a non-partition column yields a **partition** recommendation
  marked high-effort (rebuild).
- A selective WHERE predicate yields a **PREWHERE rewrite** and the rewriter never mutates.
- **No code path executes DDL** — assert the engine's public surface has no execute
  function and the recommendation objects are inert text.
- Coverage: on a fixture set of slow queries, ≥70% produce ≥1 recommendation.
- (Ties into plan 51 golden tests — keep fixtures reusable.)

### Open questions (resolve against the live repo BEFORE coding)

- **How does the agent currently meter usage?** Find the generation post-hook / usage
  store (plan 14's `addAiSpend`) and reuse it verbatim for advisor metering. (verify)
- **Selectivity source:** can we get column cardinality cheaply (e.g. `uniqCombined` on a
  sample, or `system.columns`/`system.parts` stats) without a heavy scan? Decide the
  estimate source; prefer EXPLAIN-derived + parts stats over ad-hoc scans (no surprise
  query load). Record the choice.
- **WASM reuse:** does `rust/monitor-core` already have granule/selectivity math worth
  reusing? If not, keep scoring in TS. Decide and note.
- **Which slow-query source** feeds `/advisor` (a `query_log` reader that already exists
  vs. a new query)? Reuse the existing reader if present. (verify)

## STOP conditions & drift check

Drift check (run first):
`git diff --stat -- apps/dashboard/src/lib/ai apps/dashboard/src/lib/insights packages/mcp-server/src` — reconcile pointers if these changed.

STOP and report (do NOT improvise) if:
- Implementing any recommendation would require an **execute/apply** code path — the
  recommend-only invariant is absolute; there must be zero DDL-execution surface.
- You cannot obtain EXPLAIN/schema/parts data read-only without risking heavy scan load
  on the target cluster (report the query-load concern before shipping a scanner).
- Metering can't be wired without changing billing internals beyond reusing the existing
  usage path (report the coupling).
- The needed change exceeds the listed files (e.g. a new billing table) — report scope creep.

## Verification

```bash
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/ai/advisor/__tests__ --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

ALL must hold:
- [ ] For a slow query (id or SQL) the engine returns **ranked** skip-index / projection /
      partition / PREWHERE recommendations with DDL text, risk, effort, and an estimated
      impact; ≥70% of analyzed slow queries get ≥1 recommendation.
- [ ] Exposed via the agent tool `get_optimization_recommendations`, an MCP advisor tool,
      and the `/advisor` page (copy-DDL, not apply).
- [ ] Each invocation meters as premium usage on paid tiers; fails open for self-host.
- [ ] **Safety (load-bearing)**: the advisor RECOMMENDS DDL and NEVER auto-applies — there
      is no execute/apply surface anywhere; recommendations are inert text and are
      validated (EXPLAIN before/after where feasible) to not break existing query plans;
      candidates that could regress other queries carry an explicit risk note.
- [ ] All impact numbers are labeled estimates (honest claims); advisor is read-only vs
      `system.*` and degrades gracefully.
- [ ] `type-check`, `build`, `bun test src/lib/ai/advisor/__tests__ --isolate`, `lint`
      all exit 0.
- [ ] No files outside scope modified; `plans/README.md` row updated.

---

Priority **P0** · Effort **XL** · Depth **E** · Wave **AI (THE WEDGE)** · Lever **Revenue + AI-differentiation + Adoption**
