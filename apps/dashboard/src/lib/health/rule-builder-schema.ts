/**
 * Custom alert rule builder (plan 32).
 *
 * Lets a user define a numeric-threshold alert rule WITHOUT writing SQL:
 * pick a whitelisted metric, a comparison operator, and warning/critical
 * thresholds. This module compiles that selection into an `AlertRuleDef`
 * that the sweep can register alongside the built-in rules.
 *
 * ## Security invariant (read this before touching this file)
 *
 * The builder NEVER accepts free-form SQL. The only user inputs that reach
 * SQL selection are:
 *   - `metric`  — an enum key, resolved server-side (via {@link METRIC_CATALOG})
 *                 to one fixed, vetted, read-only SQL template.
 *   - `name`    — used only to build a human label and (slugified) an id
 *                 fragment; never interpolated into SQL.
 *   - `warning` / `critical` — numbers compared in JS ({@link classifyCustomValue}),
 *                 never interpolated into SQL.
 * There is no code path that concatenates user-supplied text into a SQL
 * string. `assertReadOnlySql` is defense-in-depth (checked at compile time,
 * again before persisting, and again before registering into the sweep) —
 * it should never actually fire given the catalog is fixed, but it protects
 * against a future catalog entry being added carelessly.
 */

import { z } from 'zod'

import type {
  AlertRuleDef,
  AlertRuleSeverity,
  AlertRuleThresholds,
} from '@/lib/alerting/rule-registry'

/** Comparison operator the user picks in the builder. */
export type ComparisonOperator = '>' | '>=' | '<' | '<='

export const COMPARISON_OPERATORS: readonly ComparisonOperator[] = [
  '>',
  '>=',
  '<',
  '<=',
]

interface MetricCatalogEntry {
  /** Human-readable label shown in the builder dropdown. */
  label: string
  /** Vetted, parameterless, read-only SQL template. No user input, ever. */
  sql: string
  /** Column name to read the numeric value from the SQL result row. */
  valueKey: string
  /** Unit shown next to the value (e.g. "count", "%", "s"). */
  unit: string
  /** Skip this metric if the required table is missing (mirrors AlertRuleDef). */
  optional?: boolean
  tableCheck?: string
}

/**
 * Fixed catalog of selectable metrics. Each maps to ONE vetted, read-only SQL
 * template. Adding a metric is a deliberate code change (keeps the SQL
 * surface reviewable) — see plan 32 open question 4.
 */
export const METRIC_CATALOG = {
  'active-mutations': {
    label: 'Active (incomplete) mutations',
    sql: `SELECT count() AS v FROM system.mutations WHERE is_done = 0`,
    valueKey: 'v',
    unit: 'count',
    optional: true,
    tableCheck: 'system.mutations',
  },
  'failed-mutations': {
    label: 'Failed mutations',
    sql: `SELECT countIf(is_done = 0 AND isNotNull(latest_fail_time)) AS v FROM system.mutations`,
    valueKey: 'v',
    unit: 'count',
    optional: true,
    tableCheck: 'system.mutations',
  },
  'parts-per-partition-max': {
    label: 'Max active parts in a single partition',
    sql: `SELECT max(cnt) AS v FROM (SELECT count() cnt FROM system.parts WHERE active GROUP BY partition, table)`,
    valueKey: 'v',
    unit: 'parts',
    optional: true,
    tableCheck: 'system.parts',
  },
  'readonly-replicas': {
    label: 'Readonly replicas',
    sql: `SELECT count() AS v FROM system.replicas WHERE is_readonly`,
    valueKey: 'v',
    unit: 'count',
    optional: true,
    tableCheck: 'system.replicas',
  },
  'replication-max-lag': {
    label: 'Max replication lag (seconds)',
    sql: `SELECT max(absolute_delay) AS v FROM system.replicas`,
    valueKey: 'v',
    unit: 's',
    optional: true,
    tableCheck: 'system.replicas',
  },
  'replication-queue-max': {
    label: 'Max replication queue size',
    sql: `SELECT max(cnt) AS v FROM (SELECT count() cnt FROM system.replication_queue GROUP BY database, table)`,
    valueKey: 'v',
    unit: 'entries',
    optional: true,
    tableCheck: 'system.replication_queue',
  },
  'disk-usage-percent': {
    label: 'Worst-case disk usage (%)',
    sql: `SELECT round(max((total_space - free_space) * 100.0 / nullIf(total_space, 0)), 1) AS v FROM system.disks`,
    valueKey: 'v',
    unit: '%',
    optional: true,
    tableCheck: 'system.disks',
  },
  'running-queries': {
    label: 'Currently running queries',
    sql: `SELECT count() AS v FROM system.processes`,
    valueKey: 'v',
    unit: 'count',
    optional: true,
    tableCheck: 'system.processes',
  },
  'long-running-queries': {
    label: 'Queries running longer than 5 minutes',
    sql: `SELECT countIf(elapsed > 300) AS v FROM system.processes`,
    valueKey: 'v',
    unit: 'count',
    optional: true,
    tableCheck: 'system.processes',
  },
  'stuck-merges': {
    label: 'Merges running longer than 10 minutes',
    sql: `SELECT count() AS v FROM system.merges WHERE elapsed > 600`,
    valueKey: 'v',
    unit: 'count',
    optional: true,
    tableCheck: 'system.merges',
  },
} as const satisfies Record<string, MetricCatalogEntry>

export type MetricKey = keyof typeof METRIC_CATALOG

const METRIC_KEYS = Object.keys(METRIC_CATALOG) as [MetricKey, ...MetricKey[]]

/** Longest name we'll persist/display — generous but bounded. */
const MAX_NAME_LENGTH = 80

export const customRuleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
    metric: z.enum(METRIC_KEYS),
    op: z.enum(['>', '>=', '<', '<=']),
    warning: z.number().finite(),
    critical: z.number().finite(),
  })
  .refine(
    (v) => {
      // "higher = worse" ops require critical >= warning; "lower = worse"
      // ops require critical <= warning. Equal is allowed (degenerate but
      // harmless — every breach is immediately critical).
      const worse = v.op === '<' || v.op === '<='
      return worse ? v.critical <= v.warning : v.critical >= v.warning
    },
    {
      message:
        'critical threshold must be at least as extreme as the warning threshold for the chosen operator',
      path: ['critical'],
    }
  )

export type CustomRuleInput = z.infer<typeof customRuleInputSchema>

/**
 * Deny-list guard for generated SQL. Defense-in-depth: the SQL that reaches
 * this function always comes from {@link METRIC_CATALOG} (never user text),
 * so this should never actually reject anything in practice — but it is
 * checked at compile time, again before persisting, and again before
 * registering into the sweep, per plan 32's STOP conditions. Mirrors the
 * intent of plan 33's `assertReadOnlyAction` (ported here since 33 is not
 * merged yet).
 */
// Note: `SYSTEM` is deliberately excluded — every catalog query legitimately
// reads `FROM system.<table>`. A standalone `SYSTEM ...` admin command (e.g.
// `SYSTEM RELOAD DICTIONARY`) can't reach this function anyway: it would
// have to be a separate statement, which the semicolon check above already
// rejects, and the leading-SELECT check rejects it as a first statement too.
const FORBIDDEN_SQL_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|KILL|RENAME|ATTACH|DETACH|OPTIMIZE|EXCHANGE|REPLACE|MOVE|BACKUP|RESTORE)\b/i

export function assertReadOnlySql(sql: string): void {
  if (sql.includes(';')) {
    throw new Error('Custom rule SQL must be a single statement')
  }
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error('Custom rule SQL must be a read-only SELECT')
  }
  if (FORBIDDEN_SQL_KEYWORDS.test(sql)) {
    throw new Error('Custom rule SQL contains a forbidden keyword')
  }
}

/** Slugify a rule name for use in the generated rule id. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'rule'
}

/** Short random suffix so two rules with the same name never collide. */
function shortId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/**
 * Classify a metric value against warning/critical thresholds, honoring the
 * chosen operator's direction. Mirrors `classifyValue` in rule-registry.ts
 * but supports "lower = worse" (`<` / `<=`) in addition to "higher = worse"
 * (`>` / `>=`) — see plan 32 open question 2.
 */
export function classifyCustomValue(
  value: number | null,
  op: ComparisonOperator,
  thresholds: AlertRuleThresholds
): AlertRuleSeverity {
  if (value === null || !Number.isFinite(value)) return 'ok'
  if (op === '<' || op === '<=') {
    if (value <= thresholds.critical) return 'critical'
    if (value <= thresholds.warning) return 'warning'
    return 'ok'
  }
  if (value >= thresholds.critical) return 'critical'
  if (value >= thresholds.warning) return 'warning'
  return 'ok'
}

/**
 * Compile a validated custom rule input into an `AlertRuleDef` the registry
 * can run. Pure — no I/O, no side effects. Throws (ZodError or plain Error)
 * on invalid input; callers (API route, sweep loader) must catch.
 */
export function compileCustomRule(input: CustomRuleInput): AlertRuleDef {
  const parsed = customRuleInputSchema.parse(input)
  const catalogEntry = METRIC_CATALOG[parsed.metric]
  assertReadOnlySql(catalogEntry.sql)

  const id = `custom:${slugify(parsed.name)}-${shortId()}`

  return {
    id,
    type: 'custom',
    title: parsed.name,
    description: `Custom rule: ${catalogEntry.label} ${parsed.op} threshold`,
    sql: catalogEntry.sql,
    valueKey: catalogEntry.valueKey,
    defaults: { warning: parsed.warning, critical: parsed.critical },
    formatLabel: (v) =>
      `${v ?? 0} ${catalogEntry.unit} (${catalogEntry.label})`,
    optional: catalogEntry.optional,
    tableCheck: catalogEntry.tableCheck,
    classify: (value, thresholds) =>
      classifyCustomValue(value, parsed.op, thresholds),
  }
}
