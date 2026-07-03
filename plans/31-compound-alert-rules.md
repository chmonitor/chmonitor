# 31 — Compound alert rules (AND/OR correlation)

## Kickoff prompt

```text
Execute plans/31-compound-alert-rules.md alone (zero prior context). This is an EPIC
brief — do light discovery first, then build.
Goal: add compound alert rules that combine BASE-rule outputs with a predicate (e.g.
replication-lag>60 AND readonly-replicas>0) to cut single-metric false positives.
Evaluate base rules first, then compound rules over their results, in dependency order.
Invariants you MUST hold:
- Self-hosted/OSS stays whole; compound rules run fully OSS (they need no Clerk/D1 —
  they're pure logic over base-rule severities). Fail OPEN: a broken compound rule must
  never break the base sweep.
- AI/alerts RECOMMEND but NEVER auto-apply destructive DDL; a compound rule only raises
  a correlated alert — remediation stays ACK-gated (plans 29/33).
- Honest paywalls: ship free/OSS unless pricing marks correlation as paid.
- Postgres = NO.
Build ONLY §"Implement now". Respect STOP conditions. Then run every command in
§Verification and paste output.
```

## Current reality (audited)

**Why (spec):** all rules are single-metric; false positives need AND/OR correlation
(e.g. `lag>60 AND readonly>0`). Nothing today combines two signals.

File pointers (verified):
- Rule registry: `apps/dashboard/src/lib/alerting/rule-registry.ts` — `AlertRuleDef`
  (`{ id, type, sql?, valueKey, defaults, … }`), `classifyValue`, `ruleRegistry`
  (Map, `register/getAll/get`). **No `depends` field today.**
- Built-ins: `apps/dashboard/src/lib/alerting/builtin-rules.ts` (`registerBuiltinRules`).
- Sweep: `apps/dashboard/src/lib/health/server-sweep.ts` — the per-host loop runs each
  rule's SQL, computes `severity = classifyValue(value, thresholds)`, pushes findings,
  and dispatches via `evaluateAlert` (dedup key `hostId:ruleId`). Rules are iterated in
  `ruleRegistry.getAll()` order.
- Dedup: `apps/dashboard/src/lib/health/alert-state-store.ts` (`evaluateAlert`).
- No compound/DAG layer exists. Spec targets `src/lib/alerting/compound-rules.ts` (new).

## Goal

Define compound rules that depend on ≥2 base rules and fire based on a custom predicate
over those base rules' evaluated severities/values on the same host. The sweep evaluates
base rules first, then compound rules in dependency order (no cycles), with each compound
rule getting its own dedup identity (`hostId:compoundRuleId`) and severity.

## Implement now (approach + key files)

- **Types** in `src/lib/alerting/compound-rules.ts` (new):
  ```ts
  export interface CompoundRuleDef {
    id: string
    title: string
    description: string
    depends: string[]                     // base rule ids this rule reads
    // pure predicate over per-host base results → this rule's severity
    evaluate(inputs: Record<string, { value: number | null; severity: AlertRuleSeverity }>):
      AlertRuleSeverity
    formatLabel?(inputs: …): string
  }
  export const compoundRuleRegistry = new Map<string, CompoundRuleDef>()
  ```
- **Dependency ordering** (pure, unit-tested): `topoSortCompound(compoundRules,
  baseRuleIds): CompoundRuleDef[]` — validate every `depends` id exists as a base rule
  (or an already-ordered compound), and **throw/skip on cycles** (compound-on-compound
  allowed only if acyclic; simplest v1: compound rules depend on BASE rules only —
  document that constraint and defer compound-on-compound).
- **Example rules** shipped with built-ins registration:
  - `replica-split-brain` = `replication-lag` severity≥warning AND `readonly-replicas`>0.
  - `merge-pressure` = `stuck-merges`≥warning AND `disk-usage`≥warning.
- **Sweep integration** `server-sweep.ts`:
  - While looping base rules per host, collect `perHost[ruleId] = { value, severity }`.
  - After base rules for a host, iterate ordered compound rules: call `evaluate(perHost
    subset)`; if it returns non-ok, push a `SweepFinding` (checkId = compound id) and run
    `evaluateAlert(alertStateStore, { hostId, ruleId: compoundId, severity, cooldownMs })`
    then dispatch on `decision.notify` (respecting plan-28/29 suppression if present).
  - Wrap each compound `evaluate` in try/catch → count `errored`, never break the host loop.
- Keep the existing single-metric dispatch untouched; compound is additive.

## Open questions (resolve during discovery)
1. **Where do compound results dispatch?** Reuse `postWebhook`/routing (plan 30) exactly
   like base rules — confirm the dispatch path is shared, not duplicated.
2. **Compound-on-compound** — allow (full DAG) or restrict v1 to compound-depends-on-base
   only? Recommended: base-only for v1; note the constraint; the topo sort still guards.
3. **User-defined compounds** — this plan ships built-in compound rules in TS. Do custom
   compound rules belong here or in plan 32 (custom rule builder)? Recommended: built-ins
   here; custom compound authoring is a plan-32 follow-up.
4. **Thresholds** — do compound rules need their own threshold overrides
   (`server-alert-config` env), or is the predicate self-contained? Default: self-contained
   predicate reading base severities (which already honor env overrides).
5. **Severity of a compound** — max of inputs, or explicitly returned by `evaluate`?
   Recommended: `evaluate` returns it explicitly (most flexible).

## STOP conditions & drift check
- A throwing/misconfigured compound rule must NOT break base-rule evaluation or dispatch
  (per-rule try/catch, like base rules). Prove with a test where `evaluate` throws.
- Cycles must be rejected by `topoSortCompound` (unit-tested) — never infinite-loop the
  sweep.
- Each compound rule dedups under its own `hostId:compoundId` key — do not reuse a base
  rule's dedup identity.
- No auto-remediation; a compound rule only raises a correlated alert.
- Do not modify `decideNotification` semantics; reuse `evaluateAlert` as-is.
- Keep base-rule behavior byte-for-byte unchanged (compound is purely additive).

## Verification
```
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/alerting/compound-rules.test.ts --isolate
cd apps/dashboard && bun test src/lib/alerting/ --isolate
cd apps/dashboard && bun run lint
```

## Done criteria
- `compound-rules.ts` with `CompoundRuleDef`, registry, and pure `topoSortCompound`
  (tests: valid order, missing-dependency, cycle rejection, throwing-evaluate isolation).
- ≥2 example compound rules registered and evaluated after their base dependencies.
- Sweep evaluates base → compound in dependency order; each compound dedups under its own
  key and dispatches via the shared path.
- Base-rule behavior unchanged; a broken compound rule never breaks the base sweep.
- All four verification commands pass; open questions answered in the PR description.

Priority: P2 · Effort: L · Depth: E · Wave: A (Alerting) · Lever: Adoption
