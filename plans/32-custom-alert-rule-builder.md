# 32 — Custom alert rule builder (no-code, whitelisted)

## Kickoff prompt

```text
Execute plans/32-custom-alert-rule-builder.md alone (zero prior context). This is an
EPIC brief — do light discovery first, then build.
Goal: let users define alert rules WITHOUT editing TypeScript — "alert when [metric]
[op] [threshold]" — via a builder that compiles to SAFE whitelisted SQL, persists in D1,
and registers the rule into the sweep at startup.
Invariants you MUST hold (this plan is a SQL-injection surface — hold the line):
- The builder NEVER accepts free-form SQL. Metric/op/threshold come from server-side
  WHITELISTS only; the generated SQL is assembled from vetted fragments, never string-
  concatenated user text. Reject anything off-whitelist.
- Self-hosted/OSS stays whole; fail OPEN without Clerk (no D1 / owner throw ⇒ no custom
  rules loaded, built-ins run normally; never crash the sweep).
- AI/alerts RECOMMEND but NEVER auto-apply destructive DDL; a custom rule only classifies
  a read-only metric — remediation stays ACK-gated (plans 29/33). Generated SQL is
  read-only (readonly=1); the deny-list from plan 33 (assertReadOnlyAction) applies.
- Honest paywalls: ship free/OSS unless pricing marks custom rules as paid.
- Postgres = NO. D1 only (mirror insights/store/d1-store.ts).
Build ONLY §"Implement now". Respect STOP conditions. Then run every command in
§Verification and paste output.
```

## Current reality (audited)

**Why (spec):** users can't define rules without editing TS, which blocks self-service
alerting.

File pointers (verified):
- Rule shape + registry: `apps/dashboard/src/lib/alerting/rule-registry.ts`
  (`AlertRuleDef`, `ruleRegistry.register/getAll`, `classifyValue`). Built-ins:
  `.../builtin-rules.ts` (`registerBuiltinRules`) — the sweep calls this once at module
  load (`server-sweep.ts` top).
- Sweep: `apps/dashboard/src/lib/health/server-sweep.ts` — drives off `ruleRegistry.getAll()`;
  runs each rule's `sql` read-only (`runRuleQuery`, `clickhouse_settings:{readonly:'1'}`),
  reads `valueKey`, classifies, dispatches via `evaluateAlert`.
- D1 pattern: `apps/dashboard/src/lib/insights/store/d1-store.ts`. Migrations:
  `src/db/conversations-migrations/NNNN_*.sql` (next after `0006`).
- Health UI dir `(verify)` — colocate the builder with the existing health-settings component.
- **Soft dep on plan 33:** reuse its `assertReadOnlyAction`/deny-list validator for the
  generated SQL. If 33 isn't merged, port the same deny-list here.

## Goal

A user builds a numeric-threshold rule from whitelisted building blocks (a known metric →
a vetted SQL template, an operator, warning/critical thresholds). The builder compiles a
**safe read-only** SQL string, persists the rule in `custom_alert_rules`, and the sweep
registers all persisted custom rules at startup so they evaluate alongside built-ins.

## Implement now (approach + key files)

- **Metric whitelist** `src/lib/health/rule-builder-schema.ts` (new): a fixed catalog
  mapping each selectable metric → a vetted, parameterized read-only SQL template +
  `valueKey`, e.g.
  ```ts
  export const METRIC_CATALOG = {
    'active-mutations': { sql: `SELECT count() AS v FROM system.mutations WHERE is_done = 0`, valueKey: 'v', unit: 'count' },
    'parts-per-partition-max': { sql: `SELECT max(cnt) AS v FROM (SELECT count() cnt FROM system.parts WHERE active GROUP BY partition, table)`, valueKey: 'v', unit: 'parts' },
    'readonly-replicas': { sql: `SELECT count() AS v FROM system.replicas WHERE is_readonly`, valueKey: 'v', unit: 'count' },
    // …a curated set; NO user SQL, NO interpolated identifiers
  } as const
  ```
  - Zod schema: `{ name, metric: keyof METRIC_CATALOG, op: '>'|'>='|'<'|'<=', warning: number,
    critical: number }`. The threshold is a **number bound at classify time**, not injected
    into SQL — the SQL only *reads the metric*; comparison happens in `classifyValue`
    (extend `classifyValue`/add a comparator to honor `<`/`<=` if needed, or normalize so
    higher = worse).
  - `compileCustomRule(input): AlertRuleDef` — pure; picks the template from the catalog,
    sets `id = 'custom:' + slug(name)`, `type:'custom'`, `defaults:{warning,critical}`.
    **No string interpolation of user input into SQL.** Unit-test that off-catalog metrics
    and non-numeric thresholds are rejected, and that output SQL === the catalog template.
  - Defense-in-depth: run the generated SQL through the plan-33 `assertReadOnlyAction`
    deny-list before persisting AND before registering.
- **D1 store** `custom_alert_rules(id TEXT PK, owner_id TEXT, name TEXT, metric TEXT,
  op TEXT, warning REAL, critical REAL, enabled INTEGER, created_at INTEGER)` +
  `src/lib/health/custom-rules-store.ts` (mirror insights store; CRUD; swallow failures).
- **API** `src/routes/api/v1/health/custom-rules.ts`: GET/POST/DELETE, owner-scoped,
  writes auth-gated, owner try/catch → OSS single-tenant. POST validates with the zod
  schema and rejects off-catalog metrics with 400.
- **Sweep registration** `server-sweep.ts`: at sweep start (or module load, `(verify)`
  timing — the sweep runs per cron tick, so loading custom rules per-sweep is fine and
  picks up edits), fetch enabled custom rules for the owner, `compileCustomRule` each,
  and `ruleRegistry.register(...)` (unregister stale custom ids first to avoid drift).
  On D1 failure ⇒ skip (built-ins still run).
- **UI** `src/components/health/rule-builder.tsx` `(verify dir)`: dropdown metric +
  operator + warning/critical inputs + name; live preview of the compiled (read-only)
  SQL; save/list/delete via the API; "test" runs the metric read-only against a host.

## Open questions (resolve during discovery)
1. **Registration lifetime** — register custom rules per-sweep (simplest, picks up edits,
   recommended) or once at boot with a reload hook? The sweep is cron-driven; per-sweep
   load is cheap. Confirm no double-register (unregister-then-register by id).
2. **Operator direction** — the catalog is authored so "higher = worse"; do we need `<`/`<=`
   (e.g. "cache hit ratio < 0.9")? If yes, extend `classifyValue` with a comparator field
   rather than inverting SQL. Decide and document.
3. **Per-owner isolation in the sweep** — the sweep is owner-agnostic today; whose custom
   rules load? `''` OSS single-tenant is acceptable for self-host; multi-tenant `(verify)`.
4. **Catalog size** — start with ~6–10 curated metrics; adding metrics is a code change
   (deliberate: keeps the SQL surface vetted). Confirm that's acceptable product-wise.
5. **Free vs paid** — is custom rule authoring advertised as paid? Gate via
   `plan-enforcement.ts` only if pricing says so; else free.

## STOP conditions & drift check
- If you are ever concatenating user-supplied text into a SQL string — STOP. The only
  user inputs that reach SQL selection are an enum key (metric) resolved server-side to a
  fixed template; thresholds are numbers compared in `classifyValue`, never in SQL.
- Generated SQL must be read-only and pass the plan-33 deny-list at both persist and
  register time.
- No D1 / owner throw ⇒ zero custom rules loaded, built-ins unaffected; sweep never
  crashes. Prove with a pure `compileCustomRule` test (no D1) and a store-failure path.
- Unregister stale custom rule ids before re-registering to prevent orphan rules.
- No auto-remediation; custom rules only classify a metric.
- Do not expose a free-form SQL field anywhere in the builder or API.

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/health/rule-builder-schema.test.ts --isolate
cd apps/dashboard && bun test src/lib/health/ --isolate
cd apps/dashboard && bun run lint
```

## Done criteria
- `rule-builder-schema.ts` with `METRIC_CATALOG` + zod + pure `compileCustomRule`
  (tests: off-catalog metric rejected, non-numeric threshold rejected, output SQL equals
  the catalog template, deny-list passes).
- `custom_alert_rules` D1 + store + owner-scoped CRUD route (writes auth-gated, POST
  rejects off-catalog with 400, fails open).
- Sweep registers enabled custom rules (unregistering stale ids) and evaluates them with
  built-ins; D1 failure degrades to built-ins only.
- Builder UI compiles/preview/save/list/delete/test; no free-form SQL field exists.
- All four verification commands pass; open questions answered in the PR description.

Priority: P2 · Effort: M · Depth: E · Wave: A (Alerting) · Lever: Adoption
