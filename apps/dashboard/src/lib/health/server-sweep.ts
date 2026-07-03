import type { ClickHouseConfig } from '@chm/clickhouse-client'
import type {
  AlertRuleDef,
  AlertRuleSeverity,
} from '@/lib/alerting/rule-registry'
import type { AlertPayload, AlertSeverity } from './adapters'

import { buildEmailBody } from './adapters'
import { alertStateStore, evaluateAlert } from './alert-state-store'
import { sendAlertEmail } from './email-transport'
import {
  getServerAlertConfig,
  getServerAlertCooldownMs,
  getServerEmailConfig,
  getServerThresholdOverrides,
} from './server-alert-config'
import { fetchData, getClickHouseConfigs } from '@chm/clickhouse-client'
import { debug, error } from '@chm/logger'
import { registerBuiltinRules } from '@/lib/alerting/builtin-rules'
import { classifyValue, ruleRegistry } from '@/lib/alerting/rule-registry'
import { generateInsights } from '@/lib/insights/generate-insights'

// Register pluggable alert rules into the global ruleRegistry once at module
// load. The sweep drives itself from `ruleRegistry.getAll()`; the /health page
// UI is driven independently by the (matching) HEALTH_CHECKS definitions.
registerBuiltinRules()

type Severity = AlertRuleSeverity

const SEVERITY_ORDER: Record<Severity, number> = {
  ok: 0,
  warning: 1,
  critical: 2,
}

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

export interface SweepSummary {
  ranAt: string
  enabled: boolean
  webhookConfigured: boolean
  /** Whether `HEALTH_ALERT_EMAIL_*` env vars resolve to a usable email config. */
  emailConfigured: boolean
  minSeverity: 'warning' | 'critical'
  hostsChecked: number
  totalChecks: number
  totalFindings: number
  alertsDispatched: number
  /** Alerts suppressed by the dedup state store (already-firing conditions). */
  alertsSuppressed: number
  /** Recovery notifications sent for conditions that returned to ok. */
  recoveries: number
  /** Emails successfully sent (only counted when email is configured). */
  emailsDispatched: number
  /** Total AI insights generated and persisted across all hosts. */
  insightsGenerated: number
  hosts: SweepHostSummary[]
  findings: SweepFinding[]
}

function hostLabel(config: ClickHouseConfig): string {
  return config.customName?.trim() || config.host
}

/**
 * Run a single rule's SQL on one host in read-only mode and read the numeric
 * value from the configured `valueKey`. Mirrors the client read path
 * (`readOnlyQuery`) so cron results match what the Health dashboard shows.
 */
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

/**
 * Whether a rule should run on this host given the table-existence probe.
 * Non-optional rules always run. Optional rules with a `tableCheck` are skipped
 * only when we positively know the table is absent.
 */
function shouldRunRule(
  rule: AlertRuleDef,
  tables: Set<string> | null
): boolean {
  if (!rule.sql) return false
  if (!rule.optional || !rule.tableCheck || tables === null) return true
  return tables.has(rule.tableCheck)
}

/**
 * POST an alert to the configured webhook using the EXACT payload shape the
 * `/api/v1/health/webhook` proxy forwards upstream (`{ text, content: text }`),
 * so Slack (`text`) and Discord (`content`) both render it. Server-side, no CORS
 * proxy needed — we post directly to the operator-configured webhook URL.
 */
async function postWebhook(url: string, text: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: controller.signal,
    })
    if (!res.ok) {
      error(
        '[health-sweep] Webhook returned non-OK status',
        new Error(`Status ${res.status}`)
      )
    }
    return res.ok
  } catch (err) {
    error('[health-sweep] Webhook POST failed', err as Error)
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Autonomous health sweep: runs every registered alert rule over ALL hosts,
 * classifies severity from each rule's thresholds (with env overrides), and
 * dispatches a webhook alert for any finding at or above the configured minimum
 * severity — but only when the dedup state store says the alert is genuinely
 * new, escalated, past its cooldown, or a recovery. A persistent condition no
 * longer webhooks on every run.
 *
 * Disabled (or no webhook URL) → rules still run, alerts are skipped.
 *
 * Email (`HEALTH_ALERT_EMAIL_*`) is dispatched ADDITIVELY alongside the
 * webhook, inside the same notify decision — it does not gate or duplicate the
 * dedup evaluation (`evaluateAlert` still runs exactly once per rule/host).
 * This means today an email is only sent when the webhook path is ALSO
 * enabled+configured (`canDispatch`); a standalone "email only, no webhook"
 * sweep trigger would require restructuring this single dedup gate into
 * multi-channel fan-out, which is plans/30-per-rule-alert-routing.md's job, not
 * this one. Unconfigured email (`getServerEmailConfig() === null`) leaves this
 * function's behavior byte-for-byte identical to before email support existed.
 */
export async function runHealthSweep(): Promise<SweepSummary> {
  const ranAt = new Date().toISOString()
  const settings = getServerAlertConfig()
  const webhookConfigured = Boolean(settings.webhookUrl)
  const canDispatch = settings.webhookEnabled && webhookConfigured
  const minRank = SEVERITY_ORDER[settings.minSeverity]
  const cooldownMs = getServerAlertCooldownMs()
  const emailConfig = getServerEmailConfig()

  const rules = ruleRegistry.getAll()
  const thresholdOverrides = getServerThresholdOverrides(rules.map((r) => r.id))

  const configs = getClickHouseConfigs()

  const hosts: SweepHostSummary[] = []
  const findings: SweepFinding[] = []
  let insightsGenerated = 0
  let alertsDispatched = 0
  let alertsSuppressed = 0
  let recoveries = 0
  let emailsDispatched = 0

  for (const config of configs) {
    const name = hostLabel(config)
    let checksRun = 0
    let errored = 0
    let skipped = 0

    const tables = await getExistingSystemTables(config.id)

    for (const rule of rules) {
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
          ...(thresholdOverrides[rule.id] ?? {}),
        }
        const severity = classifyValue(value, thresholds)

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

        // Dedup + dispatch. Sub-threshold severities count as 'ok' so the state
        // store only tracks conditions the operator cares about (and a drop
        // below the threshold reads as a recovery).
        if (canDispatch) {
          const effective: Severity =
            SEVERITY_ORDER[severity] >= minRank ? severity : 'ok'
          const { decision, commit } = evaluateAlert(alertStateStore, {
            hostId: config.id,
            ruleId: rule.id,
            severity: effective,
            cooldownMs,
          })
          if (decision.notify) {
            const label = rule.formatLabel
              ? rule.formatLabel(value)
              : String(value)
            const text =
              decision.kind === 'recovery'
                ? `[RECOVERY] ${rule.title} — resolved (host ${name})`
                : `[${effective.toUpperCase()}] ${rule.title} — ${label} (host ${name})`
            const ok = await postWebhook(settings.webhookUrl, text)

            // Additive email channel: only attempted when configured. Never
            // gates or blocks the webhook path, and never touches dedup — the
            // `evaluateAlert`/`commit()` pair above still runs exactly once.
            let emailOk = false
            if (emailConfig) {
              const emailSeverity: AlertSeverity =
                decision.kind === 'recovery'
                  ? 'recovery'
                  : effective === 'critical'
                    ? 'critical'
                    : 'warning'
              const emailPayload: AlertPayload = {
                severity: emailSeverity,
                hostLabel: name,
                hostId: config.id,
                metric: rule.id,
                value,
                warnThreshold: thresholds.warning,
                critThreshold: thresholds.critical,
                title: rule.title,
                label: decision.kind === 'recovery' ? 'resolved' : label,
                timestamp: ranAt,
              }
              emailOk = await sendAlertEmail(
                emailConfig,
                buildEmailBody(emailPayload)
              )
              if (emailOk) emailsDispatched++
            }

            if (ok || emailOk) {
              // Persist "notified" only when at least one channel delivered —
              // a fully failed delivery leaves no record, so the next sweep
              // retries instead of suppressing.
              commit()
              alertsDispatched++
              if (decision.kind === 'recovery') recoveries++
            }
          } else {
            // Non-notify decisions (dedup/de-escalation/recovery-cleared
            // bookkeeping) still commit — only the notify path gates on
            // delivery.
            commit()
            if (SEVERITY_ORDER[severity] >= minRank) {
              // A current finding that we chose not to re-send (deduped).
              alertsSuppressed++
            }
          }
        }
      } catch (err) {
        errored++
        debug(
          `[health-sweep] check "${rule.id}" failed on host ${config.id}`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }

    hosts.push({
      hostId: config.id,
      hostName: name,
      checksRun,
      findings: findings.filter((f) => f.hostId === config.id).length,
      errored,
      skipped,
    })

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
  }

  return {
    ranAt,
    enabled: settings.webhookEnabled,
    webhookConfigured,
    emailConfigured: emailConfig !== null,
    minSeverity: settings.minSeverity,
    hostsChecked: configs.length,
    totalChecks: hosts.reduce((sum, h) => sum + h.checksRun, 0),
    totalFindings: findings.length,
    alertsDispatched,
    alertsSuppressed,
    recoveries,
    emailsDispatched,
    insightsGenerated,
    hosts,
    findings,
  }
}
