/**
 * Batched health KPIs — one `SELECT` per host per sweep tick (issue #3682).
 *
 * ## The shape of the win
 *
 * `runHostSweep` used to run one `fetchData` per rule: 12 built-in rules meant
 * 12 statements, 12 round trips and 12 `query_log` rows per host per tick. Ten
 * of those twelve are single-row scalar aggregates over small system tables
 * (`system.replicas`, `system.disks`, `system.merges`, `system.mutations`, …),
 * so they are folded into one `UNION ALL` statement. Measured on ClickHouse
 * 26.7.22.4, a `UNION ALL` of one-row branches logs exactly one `QueryFinish`
 * row — the batching is visible in `system.query_log`, not just in the
 * round-trip count.
 *
 * ## Why the SQL is embedded, not restated
 *
 * Each branch is the rule's *own* `sql`, verbatim, as a sub-select:
 *
 * ```sql
 * SELECT 'readonly-replicas' AS rule_id, toString(`readonly_count`) AS value
 * FROM ( SELECT count() AS readonly_count FROM system.replicas WHERE is_readonly = 1 )
 * UNION ALL …
 * ```
 *
 * The alternative — hand-writing a scalar expression per KPI — is the same
 * duplication that let `tableCheck` drift out of sync with the SQL it guards,
 * except now the *value* would drift too. Embedding makes drift structurally
 * impossible: change a rule's SQL and the batch changes with it, because the
 * batch contains that SQL.
 *
 * `toString` is deliberate. The branches return mixed numeric types
 * (`UInt64` counts, `Int64` delays, `Float64` percentages) and `UNION ALL`
 * would coerce all of them to a common supertype, quietly rounding a count
 * through `Float64`. Strings round-trip exactly, and `Number()` on the way
 * back is what the unbatched path already did.
 *
 * ## Which rules are excluded, and why
 *
 * {@link BATCH_EXCLUDED_RULE_IDS} holds the two `system.parts` scans. Folding
 * them in would still save one round trip each but would put the heaviest
 * queries in the statement every other check depends on: a slow parts scan
 * would then hold up ten cheap checks, and one branch failing would take all
 * ten down with it. They stay on their own statement. Anything whose SQL
 * cannot be nested (trailing `SETTINGS`, a semicolon, a non-`SELECT` leading
 * keyword) is excluded automatically by {@link isSubSelectSafe}, so adding a
 * rule cannot silently break the batch.
 */

import type { AlertRuleDef } from '@/lib/alerting/rule-registry'

/**
 * Rule ids that never ride the batch. Both scan `system.parts` — see the
 * module header for why the heaviest query is kept out of the statement the
 * other ten depend on.
 */
export const BATCH_EXCLUDED_RULE_IDS: readonly string[] = [
  'parts-pressure',
  'ttl-partition-health',
]

/** A rule that will be evaluated inside the batched statement. */
export interface BatchedKpi {
  readonly ruleId: string
  readonly valueKey: string
  /** The rule's own SQL, verbatim. */
  readonly sql: string
}

/** One parsed `(rule_id, value)` row of the batched result. */
export interface BatchedKpiRow {
  rule_id?: string
  value?: string | number | null
}

/** Rules the batch must not touch, because they nest badly or are too heavy. */
export function isBatchableRule(rule: AlertRuleDef): boolean {
  if (rule.id.startsWith('compound:')) return false
  if (BATCH_EXCLUDED_RULE_IDS.includes(rule.id)) return false
  // The batch is one request with one settings bag; per-rule settings would
  // be dropped there, so such a rule always runs on its own statement.
  if (rule.clickhouseSettings) return false
  return isSubSelectSafe(rule.sql)
}

/**
 * Whether `sql` can be used as `FROM ( <sql> )`.
 *
 * The checks are structural rather than clever: a `SELECT` that ends in a
 * `SETTINGS` clause is not an
 * expression, and a trailing `;` terminates the statement before the closing
 * parenthesis. Both would turn a batched sweep into a sweep that errors on
 * every rule at once.
 */
export function isSubSelectSafe(sql: string | undefined): boolean {
  if (!sql) return false
  const trimmed = sql
    .trim()
    // Leading comments are common in hand-written and template-built rule SQL,
    // and `/* … */ SELECT` nests perfectly well once the comment is moved out.
    .replace(/^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)+/, '')
    .replace(/;+\s*$/, '')
  if (trimmed === '') return false
  if (!/^select\b/i.test(trimmed)) return false
  if (/\bsettings\b[^)]*$/i.test(trimmed)) return false
  return true
}

/**
 * Render the batched statement. Returns `null` for an empty rule list so a
 * caller can skip the round trip entirely rather than issue
 * `SELECT WHERE 0`.
 */
export function buildBatchedKpiSql(kpis: readonly BatchedKpi[]): string | null {
  if (kpis.length === 0) return null
  const branches = kpis.map(
    (kpi) =>
      `  SELECT '${kpi.ruleId}' AS rule_id, toString(\`${kpi.valueKey}\`) AS value\n` +
      `  FROM (\n${kpi.sql.trim().replace(/;+\s*$/, '')}\n  )`
  )
  return branches.join('\n  UNION ALL\n')
}

/**
 * Parse the batched result into `ruleId -> numeric value`.
 *
 * A missing row reads as `0`, matching the unbatched `runRuleQuery` for an
 * empty result set. A `NULL`, empty or non-numeric value reads as `null`
 * (unknown) — the sweep skips it instead of classifying it as healthy and
 * sending a false "resolved".
 */
export function parseBatchedKpiRows(
  rows: readonly BatchedKpiRow[] | null | undefined,
  kpis: readonly BatchedKpi[]
): Map<string, number | null> {
  const out = new Map<string, number | null>()
  for (const kpi of kpis) out.set(kpi.ruleId, 0)
  if (!Array.isArray(rows)) return out
  for (const row of rows) {
    const ruleId = row?.rule_id
    if (typeof ruleId !== 'string' || !out.has(ruleId)) continue
    const raw = row.value
    if (raw === null || raw === undefined || raw === '') {
      out.set(ruleId, null)
      continue
    }
    const num = Number(raw)
    out.set(ruleId, Number.isFinite(num) ? num : null)
  }
  return out
}

export interface RulePartition {
  /** Rules the batch will evaluate. */
  batched: BatchedKpi[]
  /** Rules that still need their own statement. */
  individual: AlertRuleDef[]
  /** Rules skipped because their `tableCheck` table is absent. */
  skipped: AlertRuleDef[]
}

/**
 * Split one tick's rules into the batch, the individual statements, and the
 * skips.
 *
 * `existingTables` is the capability cache's table set, or `null` when the
 * probe failed. `null` means "unknown", so nothing is skipped — a probe failure
 * must never silently disable health checks, which is the same reasoning as
 * `hasTable` answering `true` on an unknown snapshot.
 */
export function partitionRulesForSweep(
  rules: readonly AlertRuleDef[],
  existingTables: ReadonlySet<string> | null
): RulePartition {
  const batched: BatchedKpi[] = []
  const individual: AlertRuleDef[] = []
  const skipped: AlertRuleDef[] = []

  for (const rule of rules) {
    if (!rule.sql) continue
    if (
      rule.optional &&
      rule.tableCheck &&
      existingTables !== null &&
      !existingTables.has(rule.tableCheck)
    ) {
      skipped.push(rule)
      continue
    }
    if (isBatchableRule(rule)) {
      batched.push({ ruleId: rule.id, valueKey: rule.valueKey, sql: rule.sql })
      continue
    }
    individual.push(rule)
  }

  return { batched, individual, skipped }
}
