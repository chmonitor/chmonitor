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
 *
 * #3682 changed *how many* statements a tick costs, never what it reports: the
 * `optional`/`tableCheck` probe now reads the shared capability cache instead
 * of re-asking `system.tables`, and the small scalar rules ride one batched
 * `UNION ALL` (`../batch-kpi.ts`) with a per-rule fallback if the batch fails.
 */

import type { ClickHouseConfig } from '@chm/clickhouse-client'
import type { CompoundRuleInput } from '@/lib/alerting/compound-rules'
import type { AlertRuleDef } from '@/lib/alerting/rule-registry'
import type { DispatchFindingParams } from './dispatch'
import type { SweepContext } from './resolve-config'

import {
  type BatchedKpi,
  type BatchedKpiRow,
  buildBatchedKpiSql,
  parseBatchedKpiRows,
  partitionRulesForSweep,
} from '../batch-kpi'
import { getExistingTables } from '../capability-cache'
import { fetchData } from '@chm/clickhouse-client'
import { redactHostCredentials } from '@chm/clickhouse-client/redact-host'
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
  return config.customName?.trim() || redactHostCredentials(config.host)
}

/**
 * Run a single rule's SQL on one host in read-only mode and read the numeric
 * value from the configured `valueKey`. Mirrors the client read path
 * (`readOnlyQuery`) so cron results match what the Health dashboard shows.
 */
export async function runRuleQuery(
  sql: string,
  valueKey: string,
  hostId: number,
  settings?: AlertRuleDef['clickhouseSettings']
): Promise<number | null> {
  const result = await fetchData<Array<Record<string, unknown>>>({
    query: sql,
    hostId,
    format: 'JSONEachRow',
    clickhouse_settings: { ...settings, readonly: '1' },
  })

  if (result.error) {
    throw new Error(result.error.message)
  }

  const rows = result.data
  if (!Array.isArray(rows) || rows.length === 0) return 0
  const raw = rows[0]?.[valueKey]
  // A NULL / missing value is *unknown*, not healthy: returning 0 here would
  // classify as ok and send a false "resolved" for a firing alert.
  if (raw === null || raw === undefined || raw === '') return null
  const num = Number(raw)
  return Number.isFinite(num) ? num : null
}

/**
 * Best-effort set of `system.*` tables present on a host, used to honor each
 * rule's `optional`/`tableCheck`. Returns `null` when the probe itself fails —
 * callers then fall back to attempting every rule (the per-rule try/catch still
 * protects against a missing table).
 *
 * Thin wrapper over the capability cache (#3682): the probe is identical in
 * shape but now runs at most once per TTL per host for the whole process,
 * instead of once per sweep tick — and once each in `current-findings.ts` and
 * `alert-suggestions-compute.ts`, which asked the same question again.
 */
export async function getExistingSystemTables(
  hostId: number
): Promise<Set<string> | null> {
  return getExistingTables(hostId)
}

/**
 * Run every batchable rule's SQL in one statement (#3682).
 *
 * Returns `failed: true` when the batch itself could not be read — one bad
 * branch (a permission error on an optional log, say) fails the whole
 * statement. The caller then re-runs those rules individually, so batching can
 * never turn a working health check into a broken one. That is the whole safety
 * argument for folding ten queries into one: the fallback costs a slow tick,
 * never a missing signal.
 */
export async function runBatchedKpis(
  kpis: readonly BatchedKpi[],
  hostId: number
): Promise<{ values: Map<string, number | null>; failed: boolean }> {
  const sql = buildBatchedKpiSql(kpis)
  if (sql === null)
    return { values: new Map<string, number | null>(), failed: false }

  try {
    const result = await fetchData<BatchedKpiRow[]>({
      query: sql,
      hostId,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: '1' },
    })
    if (result.error) throw new Error(result.error.message)
    return {
      values: parseBatchedKpiRows(result.data, kpis),
      failed: false,
    }
  } catch (err) {
    debug(
      `[health-sweep] batched KPI query failed on host ${hostId}; falling back to per-rule queries`,
      err instanceof Error ? err.message : String(err)
    )
    return { values: new Map<string, number | null>(), failed: true }
  }
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

  // Classify one base rule's value and, when it is not ok, record a finding
  // and hand the same classification to the dispatcher. Shared by the batched
  // and unbatched paths so batching cannot change *what* is reported — only
  // how many statements it took.
  const evaluateRule = async (
    rule: AlertRuleDef,
    value: number | null
  ): Promise<void> => {
    // Unknown value (NULL / non-numeric): no classification, no finding, no
    // dispatch — so a firing alert is neither re-fired nor falsely resolved.
    // Leaving it out of `perHostResults` also makes dependent compound rules
    // treat it as a missing dependency.
    if (value === null || !Number.isFinite(value)) return
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
  }

  // Split this tick once: batched / own-statement / skipped-by-capability.
  const {
    batched,
    individual,
    skipped: skippedRules,
  } = partitionRulesForSweep(ctx.rules, tables)
  skipped += skippedRules.length
  const rulesById = new Map(ctx.rules.map((rule) => [rule.id, rule]))

  // One statement for the batchable rules, then classify each result. If the
  // batch could not be read at all, every one of them falls back to its own
  // query below.
  const batchedRules = batched
    .map((kpi) => rulesById.get(kpi.ruleId))
    .filter((rule): rule is AlertRuleDef => rule !== undefined)
  const batch = await runBatchedKpis(batched, config.id)

  for (const kpi of batched) {
    const rule = rulesById.get(kpi.ruleId)
    if (!rule) continue
    if (batch.failed) continue
    checksRun++
    try {
      await evaluateRule(rule, batch.values.get(kpi.ruleId) ?? null)
    } catch (err) {
      errored++
      debug(
        `[health-sweep] check "${rule.id}" failed on host ${config.id}`,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  // Unbatched rules (the two `system.parts` scans) plus every batched rule the
  // batch could not read.
  const unbatched: AlertRuleDef[] = batch.failed
    ? [...individual, ...batchedRules]
    : individual

  for (const rule of unbatched) {
    if (!rule.sql) continue
    checksRun++
    try {
      const value = await runRuleQuery(
        rule.sql,
        rule.valueKey,
        config.id,
        rule.clickhouseSettings
      )
      await evaluateRule(rule, value)
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
