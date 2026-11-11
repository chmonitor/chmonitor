/**
 * Read-only "current findings" snapshot for the Active Alerts panel (plan 29).
 *
 * The health sweep (`server-sweep.ts`) computes findings AND dispatches
 * webhooks in the same pass, with no cache of the last result — there was no
 * safe way to ask "what's firing right now" without triggering a real sweep
 * (and its webhook fan-out). This module runs the SAME rule-evaluation logic
 * (rule registry + threshold classification) in a dry-run, read-only mode: no
 * dedup-state writes, no webhook, no insights generation, no alert-history
 * writes. Query dispatch is shared with the sweep; stateful rules read their
 * persisted evidence without creating tables or saving observations.
 */

import type { ClickHouseConfig } from '@chm/clickhouse-client'

import { getExistingTables, getHostCapabilities } from './capability-cache'
import { resolveThresholdOverrides } from './declarative/thresholds'
import { ruleAppliesToHost } from './replication-usage'
import { queryHealthRule } from './rule-query'
import { getServerEnabledRules } from './server-alert-config'
import { isRuleEnabled } from './sweep/suppression'
import { getClickHouseConfigs } from '@chm/clickhouse-client'
import { redactHostCredentials } from '@chm/clickhouse-client/redact-host'
import { registerBuiltinRules } from '@/lib/alerting/builtin-rules'
import {
  classifyValue,
  ruleLabel,
  ruleRegistry,
} from '@/lib/alerting/rule-registry'

registerBuiltinRules()

export interface CurrentFinding {
  hostId: number
  hostName: string
  ruleId: string
  title: string
  severity: 'warning' | 'critical'
  value: number | null
  label: string
  /** Up to 5 names behind a count-only rule (`affectedKey`); cluster-originated. */
  affected: string[]
}

function hostLabel(config: ClickHouseConfig): string {
  return config.customName?.trim() || redactHostCredentials(config.host)
}

/**
 * Compute currently-firing conditions across every configured host, without
 * touching dedup state, webhooks, or the alert-history audit log. Errors on a
 * single host/rule are caught and skipped (mirroring the sweep's per-rule
 * try/catch) rather than failing the whole snapshot.
 *
 * #3682: the `optional`/`tableCheck` gate reads the shared capability cache
 * rather than re-running this module's own copy of the `system.tables` probe,
 * so the Active Alerts panel and the cron sweep can no longer both ask the same
 * server the same question on the same tick.
 */
export async function getCurrentFindings(options?: {
  hostId?: number
}): Promise<CurrentFinding[]> {
  const enabledRules = getServerEnabledRules()
  const rules = ruleRegistry
    .getAll()
    .filter((rule) => isRuleEnabled(rule, enabledRules))
  const thresholdOverrides = await resolveThresholdOverrides(
    rules.map((r) => r.id)
  )
  const configs = getClickHouseConfigs().filter(
    (config) => options?.hostId === undefined || config.id === options.hostId
  )

  const findings: CurrentFinding[] = []

  for (const config of configs) {
    const name = hostLabel(config)
    const tables = await getExistingTables(config.id)
    const capabilities = await getHostCapabilities(config.id)

    for (const rule of rules) {
      if (!rule.sql) continue
      if (!ruleAppliesToHost(rule, capabilities)) continue
      // Same gate as the sweep: skip an optional rule only when we positively
      // know its table is absent, and run everything when the probe failed.
      if (
        rule.optional &&
        rule.tableCheck &&
        tables !== null &&
        !tables.has(rule.tableCheck)
      ) {
        continue
      }

      try {
        const { value, affected } = await queryHealthRule(rule, config, 'read')
        // Unknown (NULL / non-numeric) is not a finding.
        if (value === null) continue
        const thresholds = {
          ...rule.defaults,
          ...(thresholdOverrides[rule.id] ?? {}),
        }
        const severity = rule.classify
          ? rule.classify(value, thresholds)
          : classifyValue(value, thresholds)
        if (severity === 'ok') continue

        findings.push({
          hostId: config.id,
          hostName: name,
          ruleId: rule.id,
          title: rule.title,
          severity,
          value,
          label: ruleLabel(rule, value, affected),
          affected,
        })
      } catch {
        // Skip — a failing check shouldn't hide the rest of the snapshot.
      }
    }
  }

  return findings
}
