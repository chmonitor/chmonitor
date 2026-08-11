import type { SweepFinding, SweepHostSummary } from './sweep/run-host'

import { flushAlertState } from './alert-state-persist'
import { alertStateStore } from './alert-state-store'
import { createDispatcher } from './sweep/dispatch'
import { resolveSweepContext } from './sweep/resolve-config'
import { runHostSweep } from './sweep/run-host'
import { debug } from '@chm/logger'
import { registerBuiltinRules } from '@/lib/alerting/builtin-rules'
import { generatePostgresInsights } from '@/lib/insights/generate-postgres-insights'

// Register pluggable alert rules into the global ruleRegistry once at module
// load. The sweep drives itself from `ruleRegistry.getAll()`; the /health page
// UI is driven independently by the (matching) HEALTH_CHECKS definitions.
registerBuiltinRules()

export type { SweepFinding, SweepHostSummary }

// Public surface of this module — the pure decision→history-record mapping
// lives with the dispatch pipeline now (#2884) but is still exported here.
export { buildAlertEventRecord } from './sweep/dispatch'

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
  /** Of `alertsSuppressed`, how many were gated by an active maintenance window. */
  maintenanceSuppressed: number
  /** Of `alertsSuppressed`, how many were gated by an active quiet-hours window. */
  quietHoursSuppressed: number
  /** Notify-worthy alerts suppressed by an active operator ACK (plan 29). */
  ackedSuppressed: number
  /** Recovery notifications sent for conditions that returned to ok. */
  recoveries: number
  /**
   * Findings parked in the time-window digest buffer this tick (#2663) instead
   * of dispatched — non-critical findings when digest window mode is on.
   */
  digestBuffered: number
  /**
   * Groupable deliveries flushed this tick — buffered entries whose window
   * closed, delivered (and grouped) now (#2663).
   */
  digestFlushed: number
  /** Emails successfully sent (only counted when email is configured). */
  emailsDispatched: number
  /** Total AI insights generated and persisted across all hosts. */
  insightsGenerated: number
  hosts: SweepHostSummary[]
  findings: SweepFinding[]
}

/**
 * Autonomous health sweep: runs every registered alert rule over ALL hosts,
 * classifies severity from each rule's thresholds (with env overrides), and
 * dispatches a notification for any finding at or above the configured minimum
 * severity — but only when the dedup state store says the alert is genuinely
 * new, escalated, past its cooldown, or a recovery. A persistent condition no
 * longer notifies on every run.
 *
 * This function is the orchestrator only — a four-stage pipeline (#2884):
 *
 *  1. {@link resolveSweepContext} (`sweep/resolve-config.ts`) — settings,
 *     routes, per-channel config, rules, thresholds/hysteresis, hosts,
 *     maintenance/quiet windows, digest window, ACKs.
 *  2. {@link createDispatcher} (`sweep/dispatch.ts`) — dedup decision,
 *     suppression gates (`sweep/suppression.ts`), per-channel fan-out, digest
 *     grouping, alert-history audit.
 *  3. {@link runHostSweep} (`sweep/run-host.ts`) — per-host base + compound
 *     rule evaluation, feeding each result to the dispatcher.
 *  4. Aggregation into {@link SweepSummary}.
 *
 * Destinations, fail-open contracts and the D1-absent (OSS/env-only) path are
 * documented on each stage's module. Disabled (`HEALTH_ALERT_ENABLED` not
 * `true`) → rules still run, alerts (including the webhook-subscriptions bus)
 * are skipped entirely.
 */
export async function runHealthSweep(): Promise<SweepSummary> {
  const ranAt = new Date().toISOString()
  const ctx = await resolveSweepContext()
  const { dispatchFinding, flushDigests, counters } =
    await createDispatcher(ctx)

  const hosts: SweepHostSummary[] = []
  const findings: SweepFinding[] = []
  let insightsGenerated = 0

  for (const config of ctx.configs) {
    const result = await runHostSweep(config, ctx, dispatchFinding)
    hosts.push(result.summary)
    findings.push(...result.findings)
    insightsGenerated += result.insightsGenerated
  }

  insightsGenerated += await runPostgresInsightSweep()

  // Flush all buffered groupable deliveries (#2663): send one combined message
  // per target that received >1 finding, then commit + count each deferred
  // finding. Runs after every host so grouping spans the whole pass.
  await flushDigests()

  // Persist the post-sweep transition/hysteresis state to D1 (#2767) so the
  // next tick (even after a restart) resumes streaks + incident timers. Runs
  // after flushDigests so deferred commits are already applied. Best-effort.
  if (ctx.alertingEnabled) await flushAlertState(alertStateStore)

  return {
    ranAt,
    enabled: ctx.settings.webhookEnabled,
    webhookConfigured: Boolean(ctx.channels.webhookUrl),
    emailConfigured: ctx.channels.email !== null,
    minSeverity: ctx.settings.minSeverity,
    hostsChecked: ctx.configs.length,
    totalChecks: hosts.reduce((sum, h) => sum + h.checksRun, 0),
    totalFindings: findings.length,
    alertsDispatched: counters.alertsDispatched,
    alertsSuppressed: counters.alertsSuppressed,
    maintenanceSuppressed: counters.maintenanceSuppressed,
    quietHoursSuppressed: counters.quietHoursSuppressed,
    ackedSuppressed: counters.ackedSuppressed,
    recoveries: counters.recoveries,
    digestBuffered: counters.digestBuffered,
    digestFlushed: counters.digestFlushed,
    emailsDispatched: counters.emailsDispatched,
    insightsGenerated,
    hosts,
    findings,
  }
}

/**
 * Postgres AI insights (cross-source, env-gated). Runs AFTER the ClickHouse
 * loop and only when CHM_FEATURE_POSTGRES_SOURCE is on — fail-closed, exactly
 * like the agent's Postgres tools. Iterates the env-configured Postgres
 * sources (`POSTGRES_*` lists) and generates insights per source. Wrapped so a
 * Postgres failure can never break the ClickHouse sweep.
 */
async function runPostgresInsightSweep(): Promise<number> {
  if (process.env.CHM_FEATURE_POSTGRES_SOURCE !== 'true') return 0
  let generated = 0
  try {
    const { getPostgresConfigs } = await import('@chm/postgres-client')
    const pgConfigs = getPostgresConfigs()
    for (const pgConfig of pgConfigs) {
      try {
        const pgInsights = await generatePostgresInsights(pgConfig.id)
        generated += pgInsights.length
      } catch (err) {
        debug(
          `[health-sweep] postgres insight generation failed on pg source ${pgConfig.id}`,
          err instanceof Error ? err.message : String(err)
        )
      }
    }
  } catch (err) {
    debug(
      '[health-sweep] postgres insight sweep skipped',
      err instanceof Error ? err.message : String(err)
    )
  }
  return generated
}
