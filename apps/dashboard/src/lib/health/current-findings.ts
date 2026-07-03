/**
 * Read-only "current findings" snapshot for the Active Alerts panel (plan 29).
 *
 * The health sweep (`server-sweep.ts`) computes findings AND dispatches
 * webhooks in the same pass, with no cache of the last result — there was no
 * safe way to ask "what's firing right now" without triggering a real sweep
 * (and its webhook fan-out). This module runs the SAME rule-evaluation logic
 * (rule registry + threshold classification) in a dry-run, read-only mode: no
 * dedup-state writes, no webhook, no insights generation, no alert-history
 * writes. Intentionally duplicates the small query/table-probe helpers from
 * `server-sweep.ts` rather than importing its internals, so this addition
 * doesn't widen the diff on that heavily-contended file.
 */

import type { ClickHouseConfig } from '@chm/clickhouse-client'
import type { AlertRuleDef } from '@/lib/alerting/rule-registry'

import { getServerThresholdOverrides } from './server-alert-config'
import { fetchData, getClickHouseConfigs } from '@chm/clickhouse-client'
import { registerBuiltinRules } from '@/lib/alerting/builtin-rules'
import { classifyValue, ruleRegistry } from '@/lib/alerting/rule-registry'

registerBuiltinRules()

export interface CurrentFinding {
  hostId: number
  hostName: string
  ruleId: string
  title: string
  severity: 'warning' | 'critical'
  value: number | null
  label: string
}

function hostLabel(config: ClickHouseConfig): string {
  return config.customName?.trim() || config.host
}

async function runRuleQuery(
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
  if (result.error) throw new Error(result.error.message)
  const rows = result.data
  if (!Array.isArray(rows) || rows.length === 0) return 0
  const raw = rows[0]?.[valueKey]
  if (raw === null || raw === undefined) return 0
  const num = Number(raw)
  return Number.isFinite(num) ? num : null
}

async function getExistingSystemTables(
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

function shouldRunRule(
  rule: AlertRuleDef,
  tables: Set<string> | null
): boolean {
  if (!rule.sql) return false
  if (!rule.optional || !rule.tableCheck || tables === null) return true
  return tables.has(rule.tableCheck)
}

/**
 * Compute currently-firing conditions across every configured host, without
 * touching dedup state, webhooks, or the alert-history audit log. Errors on a
 * single host/rule are caught and skipped (mirroring the sweep's per-rule
 * try/catch) rather than failing the whole snapshot.
 */
export async function getCurrentFindings(): Promise<CurrentFinding[]> {
  const rules = ruleRegistry.getAll()
  const thresholdOverrides = getServerThresholdOverrides(rules.map((r) => r.id))
  const configs = getClickHouseConfigs()

  const findings: CurrentFinding[] = []

  for (const config of configs) {
    const name = hostLabel(config)
    const tables = await getExistingSystemTables(config.id)

    for (const rule of rules) {
      if (!rule.sql) continue
      if (!shouldRunRule(rule, tables)) continue

      try {
        const value = await runRuleQuery(rule.sql, rule.valueKey, config.id)
        const thresholds = {
          ...rule.defaults,
          ...(thresholdOverrides[rule.id] ?? {}),
        }
        const severity = classifyValue(value, thresholds)
        if (severity === 'ok') continue

        findings.push({
          hostId: config.id,
          hostName: name,
          ruleId: rule.id,
          title: rule.title,
          severity,
          value,
          label: rule.formatLabel ? rule.formatLabel(value) : String(value),
        })
      } catch {
        // Skip — a failing check shouldn't hide the rest of the snapshot.
      }
    }
  }

  return findings
}
