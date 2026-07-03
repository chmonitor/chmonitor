# 47 — MV / Projection Designer (design MV/projection DDL from frequent aggregations, size-estimated, recommend-only)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If a STOP condition
> occurs, stop and report — do not improvise. When done, update this plan's status
> row in `plans/README.md`. This is an **epic-brief (E)**: resolve the open
> questions *before* coding, then implement.

## Kickoff prompt

```text
Execute plans/47-mv-projection-designer.md ALONE (Wave AI — extends THE WEDGE).
Goal: from frequent aggregation queries in system.query_log, design materialized-
view / projection DDL (Summing/Aggregating MergeTree) with a SIZE ESTIMATE, and
recommend it — never apply it. Invariants you MUST hold (non-negotiable):
- THE ADVISOR RECOMMENDS DDL AND NEVER AUTO-APPLIES. Output is DDL text + size
  estimate + risk + impact ONLY. No CREATE MATERIALIZED VIEW / ADD PROJECTION is
  ever executed. No apply surface. This is the load-bearing safety invariant.
- Recommendations must not break existing query plans (an MV/projection adds a
  write-path cost; surface that trade-off in the risk field, never hide it).
- Self-hosted/OSS stays whole; runs read-only against system.* and degrades
  gracefully.
- Meter as premium usage (billing meter) via the existing usage path; fail open
  for self-host.
- Honest claims: the size estimate is an ESTIMATE (target within ~10%) and labeled.
- SSRF-guard any new outbound (there should be none — CH-local + LLM).
- Postgres/multi-DB: NO.
Depends on / shares scoring with plan 46 (query-advisor-engine); reuse its
system.* readers and recommendation types where present.
This is depth E: resolve open questions first, then build:
new src/lib/ai/advisor/mv-designer.ts, agent tool recommend_materialized_view,
and mv-designer __tests__. End by running:
cd apps/dashboard && bun run type-check && bun run build &&
bun test src/lib/ai/advisor/__tests__ --isolate && bun run lint.
```

## Current reality (audited)

Per ROADMAP §4 spec 47: this **extends the wedge to aggregation workloads.** The advisor
today explains aggregations in prose but does not *design* MV/projection DDL. This plan
mines the real aggregation shapes from `query_log` and proposes a Summing/Aggregating
MergeTree MV or a projection, with a size estimate — recommend-only, like plan 46.

Pointers (confirm with `rg`, mark `(verify)`):
- Home: `src/lib/ai/advisor/mv-designer.ts` (new), alongside plan 46's engine. Reuse plan
  46's `Recommendation` type and its `system.*` readers if already landed; otherwise add
  minimal readers here. (verify — 46 may or may not be merged first)
- Agent tools: `src/lib/ai/agent/tools/` → add/extend with `recommend_materialized_view`. (verify)
- `system.query_log` reader + `system.parts` for size math; `@chm/clickhouse-client`. (verify)
- Insights collectors as a read-only `system.*` model. (verify)

## Goal

Mine the top aggregation shapes (frequent `GROUP BY` + aggregate functions) from
`system.query_log`, propose an appropriate **MV (Summing/Aggregating MergeTree) or
projection** that pre-aggregates them, **estimate the resulting size** from
`system.parts` × aggregation ratio, and emit the **DDL + size estimate + risk + impact**
as a recommendation surfaced via an agent tool — applied by nobody.

## Implement now (E — approach + key files + heuristics + open questions)

### Approach

1. **Mine aggregation shapes** from `system.query_log` over a window: group similar
   queries by normalized `(table, GROUP BY keys, aggregate functions, filters)`; rank by
   frequency × cost (`read_bytes`/duration). Keep the top-N high-cost aggregation shapes.
2. **Choose the engine** per shape:
   - Sums/counts only → **SummingMergeTree** MV.
   - Mixed aggregates (avg, uniq, quantile…) → **AggregatingMergeTree** MV with
     `-State`/`-Merge` (`AggregateFunction` columns).
   - If the aggregation can be served from the base table with a matching ORDER BY and
     the workload is read-mostly on one table → prefer a **PROJECTION** over a separate
     MV (simpler, no second table). Decide per shape and note why in the rationale.
3. **Generate DDL** (text only): `CREATE MATERIALIZED VIEW … ENGINE = {Summing|
   Aggregating}MergeTree ORDER BY (…) AS SELECT … GROUP BY …`, or `ALTER TABLE … ADD
   PROJECTION … (SELECT … GROUP BY …)`.

### Size-estimate heuristic (spell out; label as estimate)

- **MV/projection size ≈ source parts size × aggregation ratio**, where the aggregation
  ratio = estimated `(distinct grouping-key combinations) / (source rows)`. Derive:
  - source rows/bytes from `system.parts` for the base table (active parts);
  - distinct grouping-key combinations from a cheap cardinality estimate (e.g.
    `uniqCombined` over a sample, or existing column-cardinality stats) — **not** a full
    scan (no surprise load).
- Report estimated on-disk size and estimated rows for the MV/projection. Accept bar:
  **within ~10%** on the test fixtures. Everything labeled "estimate".

### Impact & risk

- Impact: estimated read reduction for the mined aggregation queries if served from the
  MV/projection (bytes/granules saved), reusing plan 46's impact-estimator if present.
- Risk (must be explicit): an MV/projection **adds write-path/merge cost and storage** —
  state that trade-off; note that AggregatingMergeTree requires `-State`/`-Merge` query
  changes; note projections rebuild on `ALTER`. Never hide the downside.

### Recommend-only + billing (mandatory, same as plan 46)

- Output is **DDL + size estimate + risk + impact**. **No execute/apply surface.**
- **Meter as premium usage** via the existing usage/entitlements path; fail open for
  self-host.

### Surface

- Agent tool `recommend_materialized_view({ table? , host?, window? })` returning the
  ranked MV/projection recommendations (structured). Optionally surface on the `/advisor`
  page from plan 46 if that page exists (copy-DDL, not apply). (verify)

### Tests — `src/lib/ai/advisor/__tests__/mv-designer.test.ts` (Bun)

Fixtures: a synthetic `query_log` with repeated `GROUP BY` shapes + `system.parts` sizes.
Assert:
- Sum/count-only shape → **SummingMergeTree** DDL; mixed-aggregate shape →
  **AggregatingMergeTree** with `-State` columns.
- A single-table read-mostly shape prefers a **projection** and says why.
- Size estimate is within ~10% of the fixture's expected size (source parts × ratio).
- Risk field names the write-path/storage trade-off.
- **No execute path** — the designer exposes no apply function; recommendations are inert
  text.
- Coverage: ≥60% of high-cost aggregation shapes in the fixture yield a recommendation
  (the accept bar).

### Open questions (resolve against the live repo BEFORE coding)

- **Is plan 46 merged?** If yes, import its `Recommendation` type, `system.*` readers, and
  impact-estimator instead of duplicating. If not, add the *minimum* local readers and
  keep types compatible so a later merge is clean. Decide and note.
- **Cardinality source for the aggregation ratio:** which cheap estimate is available
  (`uniqCombined` on a sample vs. existing stats) without heavy scan? Pick and record.
- **MV vs projection default:** confirm the repo/product preference (projections avoid a
  second table but have their own constraints). Decide the tie-breaker rule and note it.
- **query_log normalization:** is there an existing query-fingerprint/normalizer to group
  similar aggregations? Reuse it; else implement a minimal GROUP-BY/agg-function normalizer. (verify)

## STOP conditions & drift check

Drift check (run first):
`git diff --stat -- apps/dashboard/src/lib/ai/advisor apps/dashboard/src/lib/ai/agent/tools` — reconcile pointers if these changed.

STOP and report (do NOT improvise) if:
- Any recommendation would require an **execute/apply** path — recommend-only is absolute;
  zero DDL-execution surface.
- The size estimate cannot be produced without a heavy scan of user data (report the
  query-load concern before shipping a scanner).
- Metering can't be wired via the existing usage path without changing billing internals.
- The work exceeds the listed files.

## Verification

```bash
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/ai/advisor/__tests__ --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

ALL must hold:
- [ ] From frequent aggregation queries, the designer proposes MV/projection DDL with the
      correct engine (Summing/Aggregating) or a projection, a size estimate (within ~10%
      on fixtures), impact, and an explicit risk/trade-off note; ≥60% of high-cost
      aggregation shapes get a recommendation.
- [ ] Exposed via the `recommend_materialized_view` agent tool (and `/advisor` if present),
      copy-DDL only.
- [ ] Metered as premium usage on paid tiers; fails open for self-host.
- [ ] **Safety (load-bearing)**: RECOMMENDS DDL, NEVER auto-applies — no execute/apply
      surface; recommendations are inert text; the added write-path/storage cost is stated,
      never hidden; nothing changes existing query plans.
- [ ] Size/impact numbers labeled as estimates; read-only vs `system.*`; graceful degrade.
- [ ] `type-check`, `build`, `bun test src/lib/ai/advisor/__tests__ --isolate`, `lint`
      all exit 0.
- [ ] No files outside scope modified; `plans/README.md` row updated.

---

Priority **P0** · Effort **L** · Depth **E** · Wave **AI** · Lever **Revenue / AI-differentiation**
