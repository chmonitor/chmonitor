/**
 * Compound Alert Rules (AND/OR correlation)
 *
 * A compound rule combines the evaluated results of ≥2 BASE rules (from
 * `rule-registry.ts`) with a pure predicate to raise a single correlated
 * alert — e.g. `replication-lag>=warning AND readonly-replicas>0` — cutting
 * single-metric false positives.
 *
 * Design goals (mirrors `rule-registry.ts`):
 * - Pure: `evaluate()` has no side effects; the sweep supplies inputs.
 * - Pluggable: any code can call `compoundRuleRegistry.register(rule)`.
 * - Additive: compound rules extend the existing `AlertRuleDef` sweep model —
 *   they do NOT replace it. Base-rule behavior is byte-for-byte unchanged.
 * - Dedup-safe: each compound rule gets its own dedup identity
 *   (`hostId:compoundId`, via the existing `evaluateAlert`/`alertStateStore`)
 *   — never reuses a base rule's key.
 *
 * v1 constraint: a compound rule's `depends` MUST reference only BASE rule
 * ids (ids registered in `ruleRegistry`), not other compound rules. Full
 * compound-on-compound DAGs are deferred — `topoSortCompound` still guards
 * against cycles/missing deps so the constraint fails loudly rather than
 * silently misbehaving if that assumption is ever violated.
 */

import type { AlertRuleSeverity } from './rule-registry'

/** Per-base-rule result a compound rule's predicate reads. */
export interface CompoundRuleInput {
  value: number | null
  severity: AlertRuleSeverity
}

export interface CompoundRuleDef {
  /** Stable unique identifier (used for dedup key `hostId:id` and thresholds). */
  id: string
  title: string
  description: string
  /** Base rule ids (from `ruleRegistry`) this compound rule reads. Must have length ≥ 2. */
  depends: string[]
  /**
   * Pure predicate over the per-host base rule results (keyed by base rule
   * id) → this compound rule's own severity. Must not throw for well-formed
   * inputs, but the sweep wraps every call in try/catch regardless — a
   * throwing predicate never breaks base-rule evaluation.
   */
  evaluate(inputs: Record<string, CompoundRuleInput>): AlertRuleSeverity
  /** Human-readable label for the triggered value, mirrors `AlertRuleDef.formatLabel`. */
  formatLabel?: (inputs: Record<string, CompoundRuleInput>) => string
}

/**
 * Pluggable compound-rule registry. Mirrors `AlertRuleRegistry`.
 */
export class CompoundAlertRuleRegistry {
  private readonly rules = new Map<string, CompoundRuleDef>()

  register(rule: CompoundRuleDef): void {
    this.rules.set(rule.id, rule)
  }

  unregister(id: string): void {
    this.rules.delete(id)
  }

  get(id: string): CompoundRuleDef | undefined {
    return this.rules.get(id)
  }

  getAll(): CompoundRuleDef[] {
    return [...this.rules.values()]
  }

  has(id: string): boolean {
    return this.rules.has(id)
  }

  size(): number {
    return this.rules.size
  }
}

/** Global singleton. Built-in compound rules are registered in builtin-rules.ts. */
export const compoundRuleRegistry = new CompoundAlertRuleRegistry()

/**
 * Order compound rules so every rule's dependencies are evaluated before it.
 *
 * v1: `depends` may only reference `baseRuleIds` (see module docstring) — a
 * dependency that isn't a known base rule id is a configuration error and
 * throws immediately rather than silently skipping the rule. Cycles cannot
 * occur under the base-only constraint (there's nothing to cycle through:
 * compound rules never depend on each other), but the same DFS-based check
 * is included so a future compound-on-compound dependency is caught rather
 * than infinite-looping the sweep.
 *
 * Pure — no I/O, fully unit-testable.
 *
 * @throws Error listing the offending rule id(s) when a `depends` id is
 *   neither a known base rule nor another registered compound rule, or when
 *   a dependency cycle is detected.
 */
export function topoSortCompound(
  compoundRules: readonly CompoundRuleDef[],
  baseRuleIds: readonly string[]
): CompoundRuleDef[] {
  const baseIds = new Set(baseRuleIds)
  const byId = new Map(compoundRules.map((r) => [r.id, r]))

  // Validate every dependency resolves to either a base rule or another
  // known compound rule (guarding the door for future compound-on-compound
  // support even though v1 only ships base-only compounds).
  for (const rule of compoundRules) {
    for (const dep of rule.depends) {
      if (!baseIds.has(dep) && !byId.has(dep)) {
        throw new Error(
          `Compound rule "${rule.id}" depends on unknown rule "${dep}" ` +
            `(not a registered base or compound rule)`
        )
      }
    }
  }

  const ordered: CompoundRuleDef[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(rule: CompoundRuleDef): void {
    if (visited.has(rule.id)) return
    if (visiting.has(rule.id)) {
      throw new Error(
        `Cycle detected in compound alert rule dependencies at "${rule.id}"`
      )
    }
    visiting.add(rule.id)
    for (const dep of rule.depends) {
      const depRule = byId.get(dep)
      if (depRule) visit(depRule)
    }
    visiting.delete(rule.id)
    visited.add(rule.id)
    ordered.push(rule)
  }

  for (const rule of compoundRules) visit(rule)

  return ordered
}

/** Rank used to compare severities (`AlertRuleSeverity` order). Mirrors `rule-registry.ts`. */
const SEVERITY_ORDER: Record<AlertRuleSeverity, number> = {
  ok: 0,
  warning: 1,
  critical: 2,
}

/** True when `severity` is at least as bad as `min`. Convenience for `evaluate()` predicates. */
export function atLeast(
  severity: AlertRuleSeverity,
  min: AlertRuleSeverity
): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[min]
}
