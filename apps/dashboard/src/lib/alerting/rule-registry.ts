/**
 * Pluggable Alert Rule Registry
 *
 * Central registry for alert rules. Rules can be registered at startup (built-in)
 * or dynamically (plugins). The server sweep and client health hooks both iterate
 * getAll() to evaluate all registered rules.
 *
 * Design goals:
 * - Pure: classifyValue() has no side effects
 * - Pluggable: any code can call ruleRegistry.register(rule)
 * - Dedup-safe: rules have stable IDs; the dispatch layer handles incident dedup
 */

export type AlertRuleSeverity = 'ok' | 'warning' | 'critical'

/**
 * Taxonomy of alert rule types.
 * Drives grouping in the notification center and log filtering.
 */
export type AlertRuleType =
  | 'readonly-replicas'
  | 'replication-lag'
  | 'failed-mutations'
  | 'stuck-merges'
  | 'disk-usage'
  | 'query-timeout'
  | 'failed-backups'
  | 'keeper-unavailable'
  | 'mv-refresh-failures'
  | 'slow-query-regression'
  | 'custom'

export interface AlertRuleDef {
  /** Stable unique identifier (used for threshold lookup and dedup). */
  id: string
  type: AlertRuleType
  title: string
  description: string
  /** SQL to evaluate on the server. Must return a single row with `valueKey`. */
  sql?: string
  /** Column name to read the numeric value from the SQL result row. */
  valueKey: string
  /** Default thresholds. Overridable via thresholds-storage. */
  defaults: { warning: number; critical: number }
  /** Human-readable label for the triggered value. */
  formatLabel?: (value: number | null) => string
  /** When true, skip this rule if the required table is missing. */
  optional?: boolean
  /** Table to check before running the SQL (e.g. 'system.backup_log'). */
  tableCheck?: string
  /**
   * Optional custom classifier, overriding the default `classifyValue`
   * (higher-is-worse) comparison. Used by the custom alert rule builder
   * (plan 32) to support "lower = worse" operators (`<` / `<=`) without
   * changing the shared `classifyValue` semantics other rules rely on.
   */
  classify?: (
    value: number | null,
    thresholds: AlertRuleThresholds
  ) => AlertRuleSeverity
}

export interface AlertRuleThresholds {
  warning: number
  critical: number
}

/**
 * Classify a numeric value against warning/critical thresholds.
 *
 * Pure function — no side effects, no imports, fully unit-testable.
 * Matches the severity logic in server-sweep.ts and health-status.ts.
 */
export function classifyValue(
  value: number | null,
  thresholds: AlertRuleThresholds
): AlertRuleSeverity {
  if (value === null || !Number.isFinite(value)) return 'ok'
  if (value >= thresholds.critical) return 'critical'
  if (value >= thresholds.warning) return 'warning'
  return 'ok'
}

/**
 * Pluggable alert rule registry.
 *
 * Built-in rules are registered via `registerBuiltinRules()`.
 * Downstream plugins call `ruleRegistry.register(rule)` to extend.
 */
export class AlertRuleRegistry {
  private readonly rules = new Map<string, AlertRuleDef>()

  register(rule: AlertRuleDef): void {
    this.rules.set(rule.id, rule)
  }

  unregister(id: string): void {
    this.rules.delete(id)
  }

  get(id: string): AlertRuleDef | undefined {
    return this.rules.get(id)
  }

  getAll(): AlertRuleDef[] {
    return [...this.rules.values()]
  }

  has(id: string): boolean {
    return this.rules.has(id)
  }

  size(): number {
    return this.rules.size
  }
}

/** Global singleton. Built-in rules are registered in builtin-rules.ts. */
export const ruleRegistry = new AlertRuleRegistry()
