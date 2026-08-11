/**
 * Per-host rule evaluation for the health sweep (#2884).
 *
 * Runs every registered base rule's SQL on one host, classifies severity from
 * the rule's thresholds (with env overrides), then evaluates compound rules in
 * dependency order from the base results. Each non-`ok` classification becomes
 * a {@link SweepFinding}; when alerting is enabled the same classification is
 * handed to the caller-supplied `dispatch` callback (the dedup + fan-out path).
 *
 * Extracted verbatim from `runHealthSweep`'s host loop: this module owns rule
 * execution only — it never decides suppression or delivery.
 */

import type { ClickHouseConfig } from '@chm/clickhouse-client'
import type { CompoundRuleInput } from '@/lib/alerting/compound-rules'
import type { AlertRuleDef } from '@/lib/alerting/rule-registry'
import type { DispatchFindingParams } from './dispatch'
import type { SweepContext } from './resolve-config'

import { fetchData } from '@chm/clickhouse-client'
import { debug } from '@chm/logger'
import { classifyValue } from '@/lib/alerting/rule-registry'
import { generateInsights } from '@/lib/insights/generate-insights'

export interface SweepFinding {
  hostId: number
  hostName: string
  checkId: string
  title: string
  severity: 'warning' | 'critical'
  value: number | null
  label: string
}

export interface SweepHostSummary {
  hostId: number
  hostName: string
  checksRun: number
  findings: number
  errored: number
  /** Rules skipped because an optional table was absent on this host. */
  skipped: number
}

export interface HostSweepResult {
  summary: SweepHostSummary
  findings: SweepFinding[]
  /** AI insights generated + persisted for this host. */
  insightsGenerated: number
}

export function hostLabel(config: ClickHouseConfig): string {
  return config.customName?.trim() || config.host
}

/**
 * Run a single rule's SQL on one host in read-only mode and read the numeric
 * value from the configured `valueKey`. Mirrors the client read path
 * (`readOnlyQuery`) so cron results match what the Health dashboard shows.
 */
export async function runRuleQuery(
  sql: string,
  valueKey: string,
  hostId: number
): Promise<number | null> {
  const result = await fetchData<Array<Record<string, unknown>>>({
    query: sql,
    hostId,
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: '1' },
  })

  if (result.error) {
    throw new Error(result.error.message)
  }

  const rows = result.data
  if (!Array.isArray(rows) || rows.length === 0) return 0
  const raw = rows[0]?.[valueKey]
  if (raw === null || raw === undefined) return 0
  const num = Number(raw)
  return Number.isFinite(num) ? num : null
}

/**
 * Best-effort set of `system.*` tables present on a host, used to honor each
 * rule's `optional`/`tableCheck`. Returns `null` when the probe itself fails —
 * callers then fall back to attempting every rule (the per-rule try/catch still
 * protects against a missing table).
 */
export async function getExistingSystemTables(
  hostId: number
): Promise<Set<string> | null> {
  try {
    const result = await fetchData<Array<{ full: string }>>({
      query: `SELECT concat(database, '.', name) AS full FROM system.tables WHERE database = 'system'`,
      hostId,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: '1' },
    })
    if (result.error) return null
    const rows = result.data
    if (!Array.isArray(rows)) return null
    return new Set(rows.map((r) => String(r.full)))
  } catch {
    return null
  }
}

/**
 * Whether a rule should run on this host given the table-existence probe.
 * Non-optional rules always run. Optional rules with a `tableCheck` are skipped
 * only when we positively know the table is absent.
 */
export function shouldRunRule(
  rule: AlertRuleDef,
  tables: Set<string> | null
): boolean {
  if (!rule.sql) return false
  if (!rule.optional || !rule.tableCheck || tables === null) return true
  return tables.has(rule.tableCheck)
}

/**
 * Evaluate every base + compound rule on one host, dispatching each result
 * through `dispatch` when alerting is enabled.
 */
export async function runHostSweep(
  config: ClickHouseConfig,
  ctx: SweepContext,
  dispatch: (params: DispatchFindingParams) => Promise<void>
): Promise<HostSweepResult> {
  const name = hostLabel(config)
  const findings: SweepFinding[] = []
  let checksRun = 0
  let errored = 0
  let skipped = 0
  let insightsGenerated = 0

  const tables = await getExistingSystemTables(config.id)

  // Per-host base rule results, keyed by rule id — feeds compound rules
  // below. Populated for every rule that actually ran (regardless of
  // severity), so a compound predicate can read the raw value/severity of
  // a healthy base rule too (e.g. `readonly-replicas` at 0).
  const perHostResults: Record<string, CompoundRuleInput> = {}

  for (const rule of ctx.rules) {
    if (!rule.sql) continue
    if (!shouldRunRule(rule, tables)) {
      skipped++
      continue
    }
    checksRun++
    try {
      const value = await runRuleQuery(rule.sql, rule.valueKey, config.id)
      const thresholds = {
        ...rule.defaults,
        ...(ctx.thresholdOverrides[rule.id] ?? {}),
      }
      const severity = rule.classify
        ? rule.classify(value, thresholds)
        : classifyValue(value, thresholds)
      perHostResults[rule.id] = { value, severity }

      if (severity !== 'ok') {
        findings.push({
          hostId: config.id,
          hostName: name,
          checkId: rule.id,
          title: rule.title,
          severity,
          value,
          label: rule.formatLabel ? rule.formatLabel(value) : String(value),
        })
      }

      if (ctx.alertingEnabled) {
        await dispatch({
          hostId: config.id,
          hostName: name,
          ruleId: rule.id,
          ruleTitle: rule.title,
          severity,
          value,
          ruleType: rule.type,
          label: rule.formatLabel ? rule.formatLabel(value) : String(value),
          warnThreshold: thresholds.warning,
          critThreshold: thresholds.critical,
        })
      }
    } catch (err) {
      errored++
      debug(
        `[health-sweep] check "${rule.id}" failed on host ${config.id}`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  // Compound rules (plan 31): evaluated AFTER all base rules for this host,
  // in dependency order, purely from `perHostResults` (no extra SQL). Each
  // compound rule's own result is written back into `perHostResults` (as
  // `{ value: null, severity }`) so a *later* compound rule in the topo
  // order may itself depend on it — `topoSortCompound` already validates
  // and orders compound-on-compound dependencies (v1 ships base-only
  // built-ins, but the sweep honors the general case the ordering
  // guarantees). Each compound rule dedups under its own
  // `hostId:compoundId` key — never a base rule's key — and dispatches via
  // the exact same shared path. A throwing/misconfigured `evaluate()` is
  // caught per-rule and never breaks base-rule evaluation or the host loop.
  for (const compound of ctx.orderedCompoundRules) {
    const inputs: Record<string, CompoundRuleInput> = {}
    let missingDependency = false
    for (const dep of compound.depends) {
      const input = perHostResults[dep]
      if (!input) {
        missingDependency = true
        break
      }
      inputs[dep] = input
    }
    // A dependency didn't run on this host (skipped optional table, or
    // errored) — nothing to correlate; skip silently, not an error.
    if (missingDependency) continue

    try {
      const severity = compound.evaluate(inputs)
      perHostResults[compound.id] = { value: null, severity }
      if (severity !== 'ok') {
        findings.push({
          hostId: config.id,
          hostName: name,
          checkId: compound.id,
          title: compound.title,
          severity,
          value: null,
          label: compound.formatLabel ? compound.formatLabel(inputs) : severity,
        })
      }
      if (ctx.alertingEnabled) {
        await dispatch({
          hostId: config.id,
          hostName: name,
          ruleId: compound.id,
          ruleType: 'compound',
          ruleTitle: compound.title,
          severity,
          value: null,
          label: compound.formatLabel ? compound.formatLabel(inputs) : severity,
        })
      }
    } catch (err) {
      errored++
      debug(
        `[health-sweep] compound rule "${compound.id}" failed on host ${config.id}`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  // Generate + persist AI insights for this host (best-effort; never throws).
  try {
    const insights = await generateInsights(config.id)
    insightsGenerated += insights.length
  } catch (err) {
    debug(
      `[health-sweep] insight generation failed on host ${config.id}`,
      err instanceof Error ? err.message : String(err)
    )
  }

  return {
    summary: {
      hostId: config.id,
      hostName: name,
      checksRun,
      findings: findings.length,
      errored,
      skipped,
    },
    findings,
    insightsGenerated,
  }
}
