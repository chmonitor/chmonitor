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

/**
 * Kind of a remediation action declared on a rule.
 * - `runbook`: a link to operator documentation — never executed, just rendered.
 * - `diagnostic`: a READ-ONLY SQL query an operator can run on demand to pull
 *   extra context. Never DDL, never a mutation — see `assertReadOnlyAction`.
 */
export type RemediationActionKind = 'runbook' | 'diagnostic'

/**
 * A labeled remediation affordance a rule can declare. Rendered by adapters
 * (e.g. Slack buttons/links) and, for `diagnostic` actions, executable via
 * `POST /api/v1/health/actions` — which re-validates the SQL server-side
 * before running it. This is affordance, not automation: nothing here is ever
 * auto-executed, and diagnostics are read-only by construction.
 */
export interface RemediationAction {
  /** Stable, unique within the rule (e.g. 'top-mutations'). */
  id: string
  /** Button/link text. */
  label: string
  kind: RemediationActionKind
  /** Required when `kind === 'runbook'`. */
  url?: string
  /** Required when `kind === 'diagnostic'`. MUST be a read-only SELECT/SHOW/EXPLAIN/DESCRIBE. */
  sql?: string
  description?: string
}

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
   * Labeled runbook links / read-only diagnostic actions surfaced by
   * notification adapters (e.g. Slack buttons) to cut MTTR. NEVER a
   * destructive/DDL action — see `assertReadOnlyAction`.
   */
  remediationActions?: RemediationAction[]
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

/**
 * SQL keywords that make a `diagnostic` remediation action unsafe to expose as
 * a one-click affordance. Matches the DDL/DML/mutation/SYSTEM surface that
 * must never be auto-runnable from an alert.
 *
 * `SYSTEM` uses a negative lookahead for a following `.` so a legitimate
 * `system.<table>` reference (e.g. `FROM system.mutations`, the overwhelming
 * majority of diagnostic queries) does not false-positive as the `SYSTEM
 * RELOAD ...` DDL-adjacent statement.
 */
const DESTRUCTIVE_SQL_PATTERN =
  /\b(ALTER|DROP|DELETE|INSERT|UPDATE|TRUNCATE|OPTIMIZE|ATTACH|DETACH|CREATE|RENAME|GRANT|REVOKE|SYSTEM(?!\s*\.))\b/i

/** Allowed leading statement keywords for a read-only diagnostic query. */
const READ_ONLY_LEADING_PATTERN = /^\s*(SELECT|SHOW|EXPLAIN|DESCRIBE)\b/i

/**
 * Validate that a `diagnostic` remediation action's SQL is read-only.
 *
 * Pure, no side effects. Runs at BOTH rule-declaration time (unit tests over
 * every built-in rule) and request time (the `/api/v1/health/actions`
 * endpoint, defense in depth) — see plans/33-remediation-action-links.md.
 * `runbook` actions always pass (nothing to execute).
 */
export function assertReadOnlyAction(action: RemediationAction): void {
  if (action.kind !== 'diagnostic') return

  const sql = action.sql?.trim()
  if (!sql) {
    throw new Error(
      `Remediation action "${action.id}": diagnostic actions require "sql"`
    )
  }
  if (!READ_ONLY_LEADING_PATTERN.test(sql)) {
    throw new Error(
      `Remediation action "${action.id}": diagnostic SQL must start with SELECT/SHOW/EXPLAIN/DESCRIBE`
    )
  }
  if (DESTRUCTIVE_SQL_PATTERN.test(sql)) {
    throw new Error(
      `Remediation action "${action.id}": diagnostic SQL must not contain DDL/mutation/SYSTEM statements`
    )
  }
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
