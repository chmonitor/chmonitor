import type { ClickHouseConfig } from '@chm/clickhouse-client'
import type {
  CompoundRuleDef,
  CompoundRuleInput,
} from '@/lib/alerting/compound-rules'
import type {
  AlertRuleDef,
  AlertRuleSeverity,
} from '@/lib/alerting/rule-registry'
import type { AlertPayload, PagerDutyEventBody } from './adapters'
import type { AlertSeverity } from './adapters/types'
import type {
  AlertChannelId,
  AlertSeverityFloor,
} from './alert-channel-settings'
import type { AlertEventRecord } from './alert-history-store'
import type { AlertRoute, AlertRouteProvider } from './alert-routing'
import type { AlertDecision } from './alert-state-store'

import {
  buildEmailBody,
  buildPagerDutyBody,
  buildTelegramBody,
  buildTelegramDigestBody,
  buildWebhookDigestDispatchBody,
  buildWebhookDispatchBody,
  detectAdapter,
  isDigestCapableWebhook,
  summarizeDigest,
} from './adapters'
import { clearAck, isAcked, listActiveAcks } from './alert-ack-store'
import { resolveChannelDelivery } from './alert-channel-settings'
import {
  type BufferedDigestEntry,
  bufferDigestEntries,
  takeDueDigestEntries,
} from './alert-digest-buffer-store'
import { resolveDigestWindowMinutes } from './alert-digest-settings-store'
import { recordAlertEvent } from './alert-history-store'
import {
  listRoutes,
  resolveNtfyTargets,
  resolvePagerDutyTargets,
  resolvePushoverTargets,
  resolveTargets,
  resolveTelegramTargets,
} from './alert-routing'
import { alertStateStore, evaluateAlert } from './alert-state-store'
import { dispatchDedupedAlertEvent } from './alert-webhook-events'
import { loadCustomRulesIntoRegistry } from './custom-rules-store'
import { sendAlertEmail } from './email-transport'
import { dispatchHealthchecks } from './healthchecks-dispatch'
import { isSuppressed, listWindows } from './maintenance-windows'
import { dispatchNtfy } from './ntfy-dispatch'
import { dispatchOpsgenie } from './opsgenie-dispatch'
import {
  getPagerDutyFallbackRoutingKey,
  PAGERDUTY_EVENTS_API_URL,
} from './pagerduty-config'
import { dispatchPushover } from './pushover-dispatch'
import {
  activeQuietWindow,
  isQuietSuppressed,
  listQuietHours,
  markQuietSuppression,
  quietWindowEndMs,
  takeDueCatchUp,
} from './quiet-hours'
import {
  getServerAlertConfig,
  getServerAlertCooldownMs,
  getServerThresholdOverrides,
} from './server-alert-config'
import { resolveServerChannels } from './server-channel-resolve'
import { telegramSendMessageUrl } from './telegram-dispatch'
import { dispatchTwilio } from './twilio-dispatch'
import { fetchData, getClickHouseConfigs } from '@chm/clickhouse-client'
import { debug, error } from '@chm/logger'
import { registerBuiltinRules } from '@/lib/alerting/builtin-rules'
import {
  compoundRuleRegistry,
  topoSortCompound,
} from '@/lib/alerting/compound-rules'
import { classifyValue, ruleRegistry } from '@/lib/alerting/rule-registry'
import { generateInsights } from '@/lib/insights/generate-insights'
import { generatePostgresInsights } from '@/lib/insights/generate-postgres-insights'
import { buildAlertBlocksWithAck } from '@/lib/slack/blocks'
import { isSlackAppConfigured } from '@/lib/slack/config'

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

/** Which per-channel override (#2661) governs a route of each provider. */
const PROVIDER_CHANNEL: Record<AlertRouteProvider, AlertChannelId> = {
  webhook: 'webhook',
  pagerduty: 'pagerduty',
  telegram: 'telegram',
  ntfy: 'ntfy',
  pushover: 'pushover',
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

/** Result of a webhook delivery attempt, incl. the error text for the audit log. */
interface WebhookResult {
  ok: boolean
  /** Present only when `ok` is false — recorded in the alert-history store. */
  error?: string
}

/**
 * POST a pre-built webhook body to the operator-configured URL. The body is
 * chosen per target by {@link buildWebhookDispatchBody} (Discord embeds, Slack
 * blocks, or the generic `{ text, content }` wrapper) — this function only owns
 * transport (timeout + non-OK handling), so the URL → shape decision stays pure
 * and unit-testable. Server-side, no CORS proxy needed.
 */
async function postWebhook(url: string, body: unknown): Promise<WebhookResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const message = `Webhook returned status ${res.status}`
      error('[health-sweep] Webhook returned non-OK status', new Error(message))
      return { ok: false, error: message }
    }
    return { ok: true }
  } catch (err) {
    error('[health-sweep] Webhook POST failed', err as Error)
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * POST a PagerDuty Events API v2 body (`trigger` or `resolve`) to the fixed
 * enqueue endpoint, using a specific service's routing key — plan 34. Mirrors
 * {@link postWebhook}'s shape/timeout so the two dispatch paths behave the
 * same for the caller; only the content-type target differs (a real PagerDuty
 * body, not the generic `{ text, content }` wrapper).
 */
async function postPagerDutyEvent(
  body: PagerDutyEventBody
): Promise<WebhookResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(PAGERDUTY_EVENTS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const message = `PagerDuty Events API returned status ${res.status}`
      error(
        '[health-sweep] PagerDuty Events API returned non-OK status',
        new Error(message)
      )
      return { ok: false, error: message }
    }
    return { ok: true }
  } catch (err) {
    error('[health-sweep] PagerDuty Events API POST failed', err as Error)
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Map a notify decision + dispatch outcome into the shape the alert-history
 * store persists. Pure — no I/O — so the decision→record translation (the
 * trickiest part: `recovery` carries its own severity distinct from the
 * underlying `AlertRuleSeverity`, and a fresh `new` alert has no meaningful
 * previous severity) is unit-testable without mocking D1 or the sweep.
 */
export function buildAlertEventRecord(params: {
  hostId: number
  hostLabel: string
  ruleId: string
  decision: AlertDecision
  value: number | null
  delivered: boolean
  error?: string
  channel: string
  /** Injectable clock for tests. Defaults to `Date.now()`. */
  now?: number
}): AlertEventRecord {
  const { decision } = params
  // Recovery is its own severity for audit purposes — the decision's
  // `severity` field is 'ok' (the condition classifies healthy again), which
  // isn't a useful thing to show in a log of *alert* events.
  const severity: AlertEventRecord['severity'] =
    decision.kind === 'recovery'
      ? 'recovery'
      : (decision.severity as 'warning' | 'critical')
  // 'ok' means "no prior firing condition" (e.g. a brand-new alert) — no
  // previous severity worth recording.
  const prevSeverity: AlertEventRecord['prevSeverity'] =
    decision.previousSeverity === 'ok' ? null : decision.previousSeverity

  return {
    eventTime: new Date(params.now ?? Date.now()).toISOString(),
    hostId: params.hostId,
    hostLabel: params.hostLabel,
    rule: params.ruleId,
    severity,
    prevSeverity,
    decisionKind: decision.kind,
    delivered: params.delivered,
    error: params.error ?? null,
    value: params.value,
    channel: params.channel,
  }
}

/**
 * Owner id the sweep loads routes under. The sweep is a session-less cron
 * job over env-configured hosts (`getClickHouseConfigs()`), never per-user D1
 * connections — same reasoning as `alert-history-store.ts`'s host-only
 * scoping — so it uses the OSS single-tenant convention rather than resolving
 * a Clerk user. Per-user cloud routing over env hosts is not in scope here;
 * see plans/30-per-rule-alert-routing.md open question 3.
 */
const SWEEP_ROUTING_OWNER_ID = ''

/**
 * Autonomous health sweep: runs every registered alert rule over ALL hosts,
 * classifies severity from each rule's thresholds (with env overrides), and
 * dispatches a notification for any finding at or above the configured minimum
 * severity — but only when the dedup state store says the alert is genuinely
 * new, escalated, past its cooldown, or a recovery. A persistent condition no
 * longer notifies on every run.
 *
 * Destinations: for each finding, {@link resolveTargets} fans out to every
 * matching per-rule/per-host route's channel URL (`alert-routing.ts`), or
 * falls back to the legacy global `HEALTH_ALERT_WEBHOOK_URL` when nothing
 * matches — so deployments that never configure a route behave exactly as
 * before. Routes are best-effort (D1-backed; degrade to `[]` when D1 isn't
 * configured), so a routing-table hiccup never blocks the legacy fallback.
 * Opsgenie/PagerDuty/email/Twilio are each an independent env-configured
 * channel (like Opsgenie/PagerDuty above) — none of them requires the webhook
 * to also be configured; every channel is attempted and audited on its own.
 * Twilio SMS additionally honours its own severity floor (default
 * `'critical'`) independent of the global gate below — see
 * `getServerTwilioConfig`.
 *
 * The outbound webhook-subscriptions bus (`alert.fired`/`alert.resolved`,
 * #2664) is dispatched from the SAME dedup decision as every other channel,
 * but independently of whether any of THEM are configured — see
 * `dispatchDedupedAlertEvent` in `alert-webhook-events.ts`. It only depends on
 * `settings.webhookEnabled` (`HEALTH_ALERT_ENABLED`), the master switch for
 * this whole sweep's alerting; a deployment with the master switch on but zero
 * legacy destinations configured still commits dedup state and fires the bus,
 * it just has nothing for the legacy per-channel loops below to iterate over.
 *
 * Disabled (`HEALTH_ALERT_ENABLED` not `true`) → rules still run, alerts
 * (including the webhook-subscriptions bus) are skipped entirely.
 */
export async function runHealthSweep(): Promise<SweepSummary> {
  const ranAt = new Date().toISOString()
  const settings = getServerAlertConfig()
  const routes: AlertRoute[] = await listRoutes(SWEEP_ROUTING_OWNER_ID)
  const pagerDutyFallbackKey = getPagerDutyFallbackRoutingKey()
  // Unified per-channel config (#2665): the D1-persisted UI config, layered
  // over the env readers (D1 row › env fallback per channel). With no D1
  // binding every channel falls through to env, so this is byte-identical to
  // the old direct `getServer*Config()` calls for an env-only deployment.
  const channels = await resolveServerChannels(SWEEP_ROUTING_OWNER_ID)
  const webhookUrl = channels.webhookUrl
  const webhookConfigured = Boolean(webhookUrl)
  const opsgenieConfig = channels.opsgenie
  const emailConfig = channels.email
  const telegramFallback = channels.telegram
  const ntfyFallback = channels.ntfy
  const twilioConfig = channels.twilio
  const pushoverFallback = channels.pushover
  const healthchecksUrl = channels.healthchecksUrl
  // Per-channel overrides (#2661): env `getServerChannelSettings()` overridden
  // by any saved D1 row (#2665). Empty ({}) for a deployment that sets none, so
  // every gate below reduces to the historical global `settings.minSeverity`.
  const channelSettings = channels.channelSettings
  // Master switch for `dispatchFinding` (dedup + every channel, INCLUDING the
  // webhook-subscriptions bus below). Deliberately NOT ANDed with "is any
  // legacy channel configured" anymore (#2664) — the bus is its own channel
  // and must fire regardless of whether webhook/routes/PagerDuty/Opsgenie/
  // email/Telegram/ntfy/Twilio/Pushover happen to be set up; those
  // per-channel loops inside `dispatchFinding` already no-op cleanly (empty
  // target lists) when unconfigured, same as today.
  const alertingEnabled = settings.webhookEnabled
  const minRank = SEVERITY_ORDER[settings.minSeverity]
  const cooldownMs = getServerAlertCooldownMs()

  // Re-sync custom alert rules (plan 32) every sweep tick: unregisters stale
  // `custom:*` ids first, then loads whatever is currently enabled in D1.
  // This is a no-op (built-ins run unaffected) when D1 is unconfigured or the
  // load fails — see `loadCustomRulesIntoRegistry`'s own try/catch.
  await loadCustomRulesIntoRegistry()

  const rules = ruleRegistry.getAll()
  const thresholdOverrides = getServerThresholdOverrides(rules.map((r) => r.id))

  // Compound rules (plans 31): base rules already ran above their sweep. Order
  // them once up front so dependency ordering is computed a single time, not
  // per host. A misconfigured compound rule (cycle / unknown dependency) must
  // never break base-rule evaluation — fall back to "no compound rules" and
  // keep going.
  let orderedCompoundRules: CompoundRuleDef[] = []
  try {
    orderedCompoundRules = topoSortCompound(
      compoundRuleRegistry.getAll(),
      rules.map((r) => r.id)
    )
  } catch (err) {
    error('[health-sweep] compound rule ordering failed', err as Error)
  }

  const configs = getClickHouseConfigs()

  // Maintenance windows: loaded once per sweep, best-effort (never throws —
  // listWindows() already degrades to [] on any D1/binding failure).
  // (verify) The sweep runs from a cron context with no signed-in session, so
  // there is no per-tenant owner to resolve here yet — OSS single-tenant
  // ('') is correct today; multi-tenant sweep scoping is a follow-up.
  const windows = await listWindows('')

  // Quiet hours: recurring time-of-day silence windows (#2662), loaded once
  // per sweep alongside maintenance windows. Same best-effort/OSS-single-tenant
  // contract — `listQuietHours` degrades to [] on any D1/binding failure.
  const quietHours = await listQuietHours('')

  // Time-window digest mode (#2663): the effective buffer window (D1 setting ›
  // env `HEALTH_ALERT_DIGEST_MINUTES`). `0` = off; in-pass grouping below still
  // runs regardless. Best-effort — resolves to 0 (off) with no D1 binding.
  const digestWindowMinutes = await resolveDigestWindowMinutes(
    SWEEP_ROUTING_OWNER_ID
  )
  const digestWindowMs = digestWindowMinutes * 60_000

  const hosts: SweepHostSummary[] = []
  const findings: SweepFinding[] = []
  let insightsGenerated = 0
  let alertsDispatched = 0
  let alertsSuppressed = 0
  let maintenanceSuppressed = 0
  let quietHoursSuppressed = 0
  let ackedSuppressed = 0
  let recoveries = 0
  let emailsDispatched = 0
  let digestBuffered = 0
  let digestFlushed = 0

  // -------------------------------------------------------------------------
  // Digest grouping (#2663). Slack + generic-webhook + Telegram sends buffer
  // here so a delivery target that receives >1 finding in this pass gets ONE
  // combined message; every other channel dispatches inline (unchanged). A
  // finding that routes to any groupable target has its dedup `commit()` +
  // dispatch accounting DEFERRED to `flushDigests()` (so the commit reflects
  // the actual grouped delivery); a finding with NO groupable target keeps the
  // exact inline-commit path it had before this feature.
  // -------------------------------------------------------------------------

  /** Deferred dedup-commit + dispatch accounting for one grouped finding. */
  interface PendingDigestCommit {
    decision: AlertDecision
    commit: () => void
    /** Non-groupable channels already dispatched inline for this finding. */
    immediateTargetCount: number
    immediateDelivered: boolean
    /** Groupable targets this finding contributes (webhook urls + telegram). */
    groupableTargetCount: number
    groupableDelivered: boolean
    committed: boolean
  }
  interface WebhookDigestEntry {
    url: string
    text: string
    payload: AlertPayload
    /** Ack-button key for a LONE Slack send (bucket size 1); Slack app only. */
    slackAck?: {
      hostId: number
      ruleId: string
      severity: 'warning' | 'critical'
    }
    /** In-pass finding awaiting commit; `null` for time-window-flushed entries. */
    pending: PendingDigestCommit | null
  }
  interface TelegramDigestEntry {
    botToken: string
    chatId: string
    payload: AlertPayload
    pending: PendingDigestCommit | null
  }
  const webhookDigestEntries: WebhookDigestEntry[] = []
  const telegramDigestEntries: TelegramDigestEntry[] = []

  // Time-window buffered entries whose window has closed — loaded once, merged
  // into the in-pass buckets before the flush so they group with fresh
  // findings for the same target. Best-effort ([] with no D1).
  const dueBufferedEntries = digestWindowMs
    ? await takeDueDigestEntries(SWEEP_ROUTING_OWNER_ID, Date.now())
    : []
  for (const entry of dueBufferedEntries) {
    if (entry.kind === 'webhook') {
      webhookDigestEntries.push({
        url: entry.url,
        text: entry.text,
        payload: entry.payload,
        slackAck: entry.slackAck,
        pending: null,
      })
    } else {
      telegramDigestEntries.push({
        botToken: entry.botToken,
        chatId: entry.chatId,
        payload: entry.payload,
        pending: null,
      })
    }
    digestFlushed++
  }

  // Active operator ACKs (plan 29), loaded once for the whole sweep.
  // `listActiveAcks` never throws — a missing/misconfigured D1 binding
  // (self-hosted/OSS default) resolves to `[]`, so `isAcked` is false
  // everywhere and dispatch behaves exactly as before ACK existed.
  // ownerId '' is the OSS single-tenant scope; multi-tenant owner wiring for
  // the cron sweep is a follow-up — see plans/29-alert-ack-manual-resolution.md.
  const ackOwnerId = ''
  const acks = await listActiveAcks(ackOwnerId)

  /**
   * Dedup + dispatch a single finding (base or compound rule) via the shared
   * webhook path. Sub-threshold severities count as 'ok' so the state store
   * only tracks conditions the operator cares about (and a drop below the
   * threshold reads as a recovery). Mutates the outer `alertsDispatched` /
   * `alertsSuppressed` / `recoveries` counters and pushes to `findings`'s
   * caller-owned array — kept as a closure (rather than returning deltas) to
   * match the single call site's original shape per rule/host iteration.
   */
  async function dispatchFinding(params: {
    hostId: number
    hostName: string
    ruleId: string
    /** Rule type (base rules) or `'compound'` — matched by `resolveTargets`. */
    ruleType: string
    ruleTitle: string
    severity: Severity
    value: number | null
    label: string
    /** Thresholds that classified this finding, when known (base rules only). */
    warnThreshold?: number | null
    critThreshold?: number | null
  }): Promise<void> {
    const {
      hostId,
      hostName: name,
      ruleId,
      ruleType,
      ruleTitle,
      severity,
      value,
      label,
      warnThreshold,
      critThreshold,
    } = params
    const effective: Severity =
      SEVERITY_ORDER[severity] >= minRank ? severity : 'ok'
    const { decision, commit } = evaluateAlert(alertStateStore, {
      hostId,
      ruleId,
      severity: effective,
      cooldownMs,
    })

    if (decision.notify && isSuppressed(windows, hostId, Date.now())) {
      // A maintenance window covers this host right now — suppress the
      // dispatch across every channel. The finding was already pushed to
      // `findings` and the rule already ran, so nothing about data
      // collection changes. Deliberately do NOT call `commit()`: the dedup
      // state store must stay exactly as it was (still "unknown" for a
      // brand-new condition, or still at its last-committed severity for a
      // persisting one) so the cooldown/escalation semantics are unaffected
      // once the window ends — the very next sweep after the window closes
      // re-evaluates fresh and notifies normally if the condition still holds.
      alertsSuppressed++
      maintenanceSuppressed++
      try {
        await recordAlertEvent({
          eventTime: new Date().toISOString(),
          hostId,
          hostLabel: name,
          rule: ruleId,
          severity:
            decision.kind === 'recovery'
              ? 'recovery'
              : (decision.severity as 'warning' | 'critical'),
          prevSeverity:
            decision.previousSeverity === 'ok'
              ? null
              : decision.previousSeverity,
          decisionKind: 'maintenance',
          delivered: false,
          value,
          channel: 'maintenance',
        })
      } catch (err) {
        debug(
          `[health-sweep] alert-history record failed for host ${hostId} rule ${ruleId}`,
          err instanceof Error ? err.message : String(err)
        )
      }
      return
    }

    if (
      decision.notify &&
      decision.kind !== 'recovery' &&
      (effective === 'warning' || effective === 'critical') &&
      isQuietSuppressed(quietHours, effective, Date.now())
    ) {
      // A quiet-hours window (#2662) silences delivery right now — same
      // dispatch-time gate as the maintenance-window block above, but recurring
      // (weekday + time-of-day in an IANA timezone) and severity-aware
      // (`severityCap` lets criticals through). Deliberately do NOT call
      // `commit()`: leaving the dedup state untouched means the first sweep
      // after the window closes re-evaluates fresh and delivers normally — the
      // catch-up. A still-suppressed critical is remembered so that delivery is
      // labeled a catch-up (warnings just resume, no catch-up).
      const now = Date.now()
      alertsSuppressed++
      quietHoursSuppressed++
      if (effective === 'critical') {
        const w = activeQuietWindow(quietHours, now)
        if (w) {
          markQuietSuppression(
            hostId,
            ruleId,
            effective,
            quietWindowEndMs(w, now)
          )
        }
      }
      try {
        await recordAlertEvent({
          eventTime: new Date().toISOString(),
          hostId,
          hostLabel: name,
          rule: ruleId,
          severity: effective,
          prevSeverity:
            decision.previousSeverity === 'ok'
              ? null
              : decision.previousSeverity,
          decisionKind: 'quiet-hours',
          delivered: false,
          value,
          channel: 'quiet-hours',
        })
      } catch (err) {
        debug(
          `[health-sweep] alert-history record failed for host ${hostId} rule ${ruleId}`,
          err instanceof Error ? err.message : String(err)
        )
      }
      return
    }

    if (decision.notify && decision.kind === 'recovery') {
      // A resolved condition should always reach the operator — never
      // suppress a recovery — and any active ACK for it is now moot.
      // Best-effort: clearAck never throws.
      void clearAck(ackOwnerId, hostId, ruleId)
    } else if (decision.notify && isAcked(acks, hostId, ruleId, Date.now())) {
      // Post-decision dispatch gate only — do NOT commit. Like the
      // maintenance-window suppression above, an acked (non-delivered)
      // notification must not start the reminder cooldown clock — otherwise a
      // short ACK (e.g. 15m) would silently suppress the next reminder until
      // the full cooldown (e.g. 60m) elapses. Once the ACK expires, the next
      // firing sweep re-evaluates fresh and delivers/commits normally.
      alertsSuppressed++
      ackedSuppressed++
      // TODO(27): historyStore.record({ ..., decisionKind: 'acked', delivered: false })
      return
    }

    if (decision.notify) {
      // Outbound webhook-subscriptions bus (#2664): fires from this SAME
      // dedup decision, independently of every legacy channel below —
      // "regardless of channel config" per the issue, this is its own
      // channel. Fire-and-forget (never awaited, never throws — see
      // `alert-webhook-events.ts` / `outbound-bus.ts`'s module docblock), so
      // a slow/unreachable subscriber endpoint can never delay or fail this
      // sweep tick. Placed before the legacy fan-out (not after / not
      // conditioned on `anyDelivered`) so it fires exactly once per notify
      // decision no matter how many — if any — legacy destinations exist.
      dispatchDedupedAlertEvent({
        hostId,
        hostLabel: name,
        ruleId,
        ruleTitle,
        decision,
        value,
        label,
      })

      // Catch-up (#2662): a critical suppressed during a quiet-hours window
      // whose window has now closed — label the (naturally re-delivered)
      // notification so the operator knows it was held back. Consumed once.
      const isQuietCatchUp =
        decision.kind !== 'recovery' &&
        takeDueCatchUp(hostId, ruleId, Date.now())
      const text =
        decision.kind === 'recovery'
          ? `[RECOVERY] ${ruleTitle} — resolved (host ${name})`
          : `${isQuietCatchUp ? '[CATCH-UP] ' : ''}[${effective.toUpperCase()}] ${ruleTitle} — ${label} (host ${name})`

      // Per-channel + per-route gate (#2661). The severity a channel is judged
      // against is the finding's own severity for an alert, or the severity it
      // recovered FROM for a recovery (so a condition that never paged a
      // critical-only channel as a warning does not page it when it clears).
      const deliverSeverity: AlertSeverityFloor | null =
        decision.kind === 'recovery'
          ? decision.previousSeverity === 'warning' ||
            decision.previousSeverity === 'critical'
            ? decision.previousSeverity
            : null
          : effective === 'warning' || effective === 'critical'
            ? effective
            : null

      /**
       * Whether a channel fires for THIS finding, via the shared resolver:
       * disabled channel never fires; else floor = route › channel › global.
       * `routeMinSeverity` is the per-route floor for route-based channels
       * (null for the env-configured single destinations).
       */
      const channelPasses = (
        channelId: AlertChannelId,
        routeMinSeverity: AlertSeverityFloor | null = null
      ): boolean =>
        deliverSeverity !== null &&
        resolveChannelDelivery({
          severity: deliverSeverity,
          globalMinSeverity: settings.minSeverity,
          channel: channelSettings[channelId],
          routeMinSeverity,
        })

      // Route-level accept predicate: a route silenced for this finding's
      // severity is simply not "matched" — it yields no target and stops
      // suppressing the legacy fallback, so a less-severe finding still reaches
      // the catch-all. Passed to every `resolve*` below.
      const routeAccept = (route: AlertRoute) =>
        channelPasses(PROVIDER_CHANNEL[route.provider], route.minSeverity)
      const matchOptions = { accept: routeAccept }

      // Fan out to every matched route's channel (plan 30), falling back to
      // the legacy global webhook when nothing matches (see `alert-routing.ts`).
      // Dedup (`evaluateAlert`) already ran ONCE above for this finding —
      // fan-out never multiplies cooldown state, it only multiplies where the
      // single decision is sent. The legacy/env fallbacks are gated by the
      // per-channel floor (routeMinSeverity=null) before being passed in, so a
      // disabled or raised-floor channel drops its fallback too.
      const targets = resolveTargets(
        routes,
        { ruleId, ruleType, hostId, hostName: name },
        channelPasses('webhook') ? webhookUrl : '',
        matchOptions
      )

      // PagerDuty services (plan 34): resolved separately from the generic
      // webhook fan-out above (`resolveTargets` already excludes
      // provider === 'pagerduty' routes — see `alert-routing.ts`), because a
      // PagerDuty target needs the real Events API v2 body/routing key
      // rather than the generic `{ text, content }` wrapper. Falls back to
      // the legacy env routing key when no route matches, same fail-open
      // contract as the webhook path.
      const pagerDutyTargets = resolvePagerDutyTargets(
        routes,
        { ruleId, ruleType, hostId, hostName: name },
        channelPasses('pagerduty') ? pagerDutyFallbackKey : '',
        matchOptions
      )

      // Telegram chats (#2655): resolved separately from the generic webhook
      // fan-out — a Telegram target needs the Bot API `sendMessage` body/URL
      // (token in the path), not the `{ text, content }` wrapper. Falls back
      // to the env-configured global chat when no route matches, same
      // fail-open contract as the webhook/PagerDuty paths.
      const telegramTargets = resolveTelegramTargets(
        routes,
        { ruleId, ruleType, hostId, hostName: name },
        channelPasses('telegram') ? telegramFallback : null,
        matchOptions
      )

      // ntfy topics (#2657): resolved separately from the generic webhook
      // fan-out — an ntfy target needs the topic URL + Title/Priority/Tags
      // headers, not the `{ text, content }` wrapper. Falls back to the
      // env-configured global topic when no route matches, same fail-open
      // contract as the webhook/PagerDuty/Telegram paths.
      const ntfyTargets = resolveNtfyTargets(
        routes,
        { ruleId, ruleType, hostId, hostName: name },
        channelPasses('ntfy') ? ntfyFallback : null,
        matchOptions
      )

      // Pushover recipients (#2659): resolved separately from the generic
      // webhook fan-out — a Pushover target needs the Messages API's
      // token/user/priority body, not the `{ text, content }` wrapper. Falls
      // back to the env-configured global recipient when no route matches,
      // same fail-open contract as the webhook/PagerDuty/Telegram/ntfy paths.
      const pushoverTargets = resolvePushoverTargets(
        routes,
        { ruleId, ruleType, hostId, hostName: name },
        channelPasses('pushover') ? pushoverFallback : null,
        matchOptions
      )

      // Opsgenie / email are single env-configured destinations (no routes) —
      // gate each on its own per-channel floor (#2661), routeMinSeverity=null.
      // Computed once so the delivery `if` and the "nothing to deliver" commit
      // accounting below agree.
      const opsgenieEligible =
        opsgenieConfig !== null && channelPasses('opsgenie')
      const emailEligible = emailConfig !== null && channelPasses('email')
      // healthchecks.io ping (#2665): sweep-side dispatch of the resolved
      // healthchecks URL, gated by the same per-channel floor. Previously
      // client-only; a URL configured from the UI (D1) or env now pings on
      // every alert/recovery.
      const healthchecksEligible =
        healthchecksUrl !== '' && channelPasses('healthchecks')

      // Normalized payload shared by every per-URL body builder below (Discord
      // embeds carry host/value/thresholds; the Slack/generic wrapper carries
      // `text`). One timestamp per finding so the embed and any Slack ack block
      // agree.
      const webhookTimestamp = new Date().toISOString()
      const webhookPayload: AlertPayload = {
        severity:
          decision.kind === 'recovery'
            ? 'recovery'
            : (effective as 'warning' | 'critical'),
        hostLabel: name,
        hostId,
        metric: ruleId,
        value,
        warnThreshold,
        critThreshold,
        title: ruleTitle,
        label,
        timestamp: webhookTimestamp,
      }

      // Digest partition (#2663): Slack / generic-webhook URLs are grouped and
      // flushed later (one combined message per target); Discord / MS Teams /
      // Google Chat keep today's inline per-finding sends. `isDigestCapableWebhook`
      // never matches those rich-embed adapters, so they land in `immediate`.
      const immediateWebhookTargets: string[] = []
      const groupableWebhookTargets: string[] = []
      for (const url of targets) {
        if (isDigestCapableWebhook(url)) groupableWebhookTargets.push(url)
        else immediateWebhookTargets.push(url)
      }

      let anyDelivered = false
      for (const url of immediateWebhookTargets) {
        const adapter = detectAdapter(url)

        // Per-URL body selection (#2656): Discord/MS Teams/Google Chat targets
        // get their rich provider bodies. Slack ack-blocks are handled on the
        // grouped path below (Slack is digest-capable, never `immediate`).
        const dispatch = buildWebhookDispatchBody({
          url,
          text,
          payload: webhookPayload,
        })
        const result = await postWebhook(url, dispatch.body)
        if (result.ok) anyDelivered = true

        // Best-effort audit trail per channel — recorded on both success and
        // failure so a slow or failing D1 write can never delay or drop the
        // alert that was just dispatched. recordAlertEvent already never
        // throws; the try/catch here is defense-in-depth, mirroring the
        // generateInsights call below. detectAdapter picks the per-URL channel
        // label (plan 26), so a fan-out to mixed Discord/Teams destinations is
        // audited per its own adapter.
        try {
          await recordAlertEvent(
            buildAlertEventRecord({
              hostId,
              hostLabel: name,
              ruleId,
              decision,
              value,
              delivered: result.ok,
              error: result.error,
              channel: adapter.id,
            })
          )
        } catch (err) {
          debug(
            `[health-sweep] alert-history record failed for host ${hostId} rule ${ruleId}`,
            err instanceof Error ? err.message : String(err)
          )
        }
      }

      if (pagerDutyTargets.length > 0) {
        // `decision.kind === 'recovery'` maps to `event_action: 'resolve'`
        // inside `buildPagerDutyBody`; the stable `chmonitor:{hostId}:{metric}`
        // dedup key is what lets PagerDuty collapse repeat triggers into one
        // open incident and auto-resolve it here. `metric` is the rule id, so
        // this key aligns 1:1 with the sweep's own `hostId:ruleId` dedup.
        const pagerDutyPayload: AlertPayload = {
          severity:
            decision.kind === 'recovery'
              ? 'recovery'
              : (effective as 'warning' | 'critical'),
          hostLabel: name,
          hostId,
          metric: ruleId,
          value,
          title: ruleTitle,
          label,
          timestamp: new Date().toISOString(),
        }

        for (const target of pagerDutyTargets) {
          const body = buildPagerDutyBody(pagerDutyPayload, {
            routingKey: target.routingKey,
          })
          const result = await postPagerDutyEvent(body)
          if (result.ok) anyDelivered = true

          try {
            await recordAlertEvent(
              buildAlertEventRecord({
                hostId,
                hostLabel: name,
                ruleId,
                decision,
                value,
                delivered: result.ok,
                error: result.error,
                channel: `pagerduty:${target.serviceName}`,
              })
            )
          } catch (err) {
            debug(
              `[health-sweep] alert-history record failed for host ${hostId} rule ${ruleId}`,
              err instanceof Error ? err.message : String(err)
            )
          }
        }
      }

      // Opsgenie (plan 26): a single global env-configured destination (no
      // per-route resolution yet, unlike webhook/PagerDuty targets above) —
      // fires whenever `opsgenieConfig` is set. `dispatchOpsgenie` never
      // throws (fails open), matching every other channel here.
      if (opsgenieConfig && opsgenieEligible) {
        const alertSeverity: AlertSeverity =
          decision.kind === 'recovery'
            ? 'recovery'
            : (effective as 'warning' | 'critical')
        const ok = await dispatchOpsgenie(
          {
            severity: alertSeverity,
            hostLabel: name,
            hostId,
            metric: ruleId,
            value,
            warnThreshold,
            critThreshold,
            title: ruleTitle,
            label,
            timestamp: new Date().toISOString(),
          },
          opsgenieConfig
        )
        if (ok) anyDelivered = true

        try {
          await recordAlertEvent(
            buildAlertEventRecord({
              hostId,
              hostLabel: name,
              ruleId,
              decision,
              value,
              delivered: ok,
              error: ok ? undefined : 'Opsgenie dispatch failed',
              channel: 'opsgenie',
            })
          )
        } catch (err) {
          debug(
            `[health-sweep] alert-history record failed for host ${hostId} rule ${ruleId}`,
            err instanceof Error ? err.message : String(err)
          )
        }
      }

      // Email (plan 25): a single global env-configured destination, same
      // shape as Opsgenie above — no per-route resolution yet. Fires whenever
      // `emailConfig` is set, independent of every other channel.
      // `sendAlertEmail` never throws (fails open): Mailgun/SendGrid send for
      // real over authenticated HTTPS; the `smtp` provider is not implemented
      // yet (Cloudflare Workers has no raw TCP) and always resolves `false`
      // with its own log line — never a silent fake "sent".
      if (emailConfig && emailEligible) {
        const alertSeverity: AlertSeverity =
          decision.kind === 'recovery'
            ? 'recovery'
            : (effective as 'warning' | 'critical')
        const emailBody = buildEmailBody({
          severity: alertSeverity,
          hostLabel: name,
          hostId,
          metric: ruleId,
          value,
          warnThreshold,
          critThreshold,
          title: ruleTitle,
          label,
          timestamp: new Date().toISOString(),
        })
        const ok = await sendAlertEmail(emailConfig, emailBody)
        if (ok) {
          anyDelivered = true
          emailsDispatched++
        }

        try {
          await recordAlertEvent(
            buildAlertEventRecord({
              hostId,
              hostLabel: name,
              ruleId,
              decision,
              value,
              delivered: ok,
              error: ok ? undefined : 'Email dispatch failed',
              channel: 'email',
            })
          )
        } catch (err) {
          debug(
            `[health-sweep] alert-history record failed for host ${hostId} rule ${ruleId}`,
            err instanceof Error ? err.message : String(err)
          )
        }
      }

      // Telegram (#2655) is digest-capable (#2663): instead of sending inline,
      // collect one entry per resolved chat and let the grouped flush send a
      // single (combined when >1 finding) MarkdownV2 message per chat. Severity
      // is mapped once for this finding's payload.
      const telegramAlertSeverity: AlertSeverity =
        decision.kind === 'recovery'
          ? 'recovery'
          : (effective as 'warning' | 'critical')
      const telegramPayload: AlertPayload = {
        severity: telegramAlertSeverity,
        hostLabel: name,
        hostId,
        metric: ruleId,
        value,
        warnThreshold,
        critThreshold,
        title: ruleTitle,
        label,
        timestamp: new Date().toISOString(),
      }
      const findingTelegramTargets = telegramTargets.map((t) => ({
        botToken: t.botToken,
        chatId: t.chatId,
        payload: telegramPayload,
      }))

      // ntfy (#2657): every resolved topic (matched routes, or the
      // env-configured global topic when nothing matched). `dispatchNtfy`
      // renders the header + plain-text body and never throws (fails open),
      // matching every other channel here.
      for (const target of ntfyTargets) {
        const alertSeverity: AlertSeverity =
          decision.kind === 'recovery'
            ? 'recovery'
            : (effective as 'warning' | 'critical')
        const ok = await dispatchNtfy(
          {
            severity: alertSeverity,
            hostLabel: name,
            hostId,
            metric: ruleId,
            value,
            warnThreshold,
            critThreshold,
            title: ruleTitle,
            label,
            timestamp: new Date().toISOString(),
          },
          { url: target.url, token: target.token }
        )
        if (ok) anyDelivered = true

        try {
          await recordAlertEvent(
            buildAlertEventRecord({
              hostId,
              hostLabel: name,
              ruleId,
              decision,
              value,
              delivered: ok,
              error: ok ? undefined : 'ntfy dispatch failed',
              channel: 'ntfy',
            })
          )
        } catch (err) {
          debug(
            `[health-sweep] alert-history record failed for host ${hostId} rule ${ruleId}`,
            err instanceof Error ? err.message : String(err)
          )
        }
      }

      // Twilio SMS (#2668): a single global env-configured destination (no
      // per-route resolution yet, unlike webhook/PagerDuty/Telegram/ntfy
      // targets above) — mirrors Opsgenie/email above. SMS costs real money
      // per message, so unlike every other channel here it also honours its
      // OWN severity floor (`twilioConfig.minSeverity`, default `'critical'`)
      // on top of the global `HEALTH_ALERT_MIN_SEVERITY` gate already applied
      // to `effective` — a warning that clears the global gate still will not
      // page a phone unless overridden via `HEALTH_ALERT_TWILIO_MIN_SEVERITY=warning`.
      // A recovery is gated on the severity it recovered FROM
      // (`decision.previousSeverity`), so a condition that never paged a phone
      // as a warning does not page one when it clears either.
      // `dispatchTwilio` never throws (fails open), matching every other
      // channel here.
      const twilioTriggerSeverity: Severity =
        decision.kind === 'recovery' ? decision.previousSeverity : effective
      const twilioEligible =
        twilioConfig !== null &&
        twilioTriggerSeverity !== 'ok' &&
        SEVERITY_ORDER[twilioTriggerSeverity] >=
          SEVERITY_ORDER[twilioConfig.minSeverity]
      if (twilioConfig && twilioEligible) {
        const alertSeverity: AlertSeverity =
          decision.kind === 'recovery'
            ? 'recovery'
            : (effective as 'warning' | 'critical')
        const ok = await dispatchTwilio(
          {
            severity: alertSeverity,
            hostLabel: name,
            hostId,
            metric: ruleId,
            value,
            warnThreshold,
            critThreshold,
            title: ruleTitle,
            label,
            timestamp: new Date().toISOString(),
          },
          twilioConfig
        )
        if (ok) anyDelivered = true

        try {
          await recordAlertEvent(
            buildAlertEventRecord({
              hostId,
              hostLabel: name,
              ruleId,
              decision,
              value,
              delivered: ok,
              error: ok ? undefined : 'Twilio dispatch failed',
              channel: 'twilio',
            })
          )
        } catch (err) {
          debug(
            `[health-sweep] alert-history record failed for host ${hostId} rule ${ruleId}`,
            err instanceof Error ? err.message : String(err)
          )
        }
      }

      // Pushover (#2659): every resolved recipient (matched routes, or the
      // env-configured global recipient when nothing matched).
      // `dispatchPushover` renders the JSON body and never throws (fails
      // open), matching every other channel here.
      for (const target of pushoverTargets) {
        const alertSeverity: AlertSeverity =
          decision.kind === 'recovery'
            ? 'recovery'
            : (effective as 'warning' | 'critical')
        const ok = await dispatchPushover(
          {
            severity: alertSeverity,
            hostLabel: name,
            hostId,
            metric: ruleId,
            value,
            warnThreshold,
            critThreshold,
            title: ruleTitle,
            label,
            timestamp: new Date().toISOString(),
          },
          { token: target.token, user: target.user }
        )
        if (ok) anyDelivered = true

        try {
          await recordAlertEvent(
            buildAlertEventRecord({
              hostId,
              hostLabel: name,
              ruleId,
              decision,
              value,
              delivered: ok,
              error: ok ? undefined : 'Pushover dispatch failed',
              channel: 'pushover',
            })
          )
        } catch (err) {
          debug(
            `[health-sweep] alert-history record failed for host ${hostId} rule ${ruleId}`,
            err instanceof Error ? err.message : String(err)
          )
        }
      }

      // healthchecks.io (#2665): a single ping URL (D1 override or env),
      // gated like every other channel. A recovery pings `<url>/fail`, an
      // alert pings the base URL — mirroring the client dispatcher exactly
      // (see `healthchecks-dispatch.ts`). `dispatchHealthchecks` never throws
      // (fails open), matching every other channel here.
      if (healthchecksEligible) {
        const ok = await dispatchHealthchecks(
          healthchecksUrl,
          decision.kind === 'recovery' ? 'recovery' : 'alert'
        )
        if (ok) anyDelivered = true

        try {
          await recordAlertEvent(
            buildAlertEventRecord({
              hostId,
              hostLabel: name,
              ruleId,
              decision,
              value,
              delivered: ok,
              error: ok ? undefined : 'healthchecks ping failed',
              channel: 'healthchecks',
            })
          )
        } catch (err) {
          debug(
            `[health-sweep] alert-history record failed for host ${hostId} rule ${ruleId}`,
            err instanceof Error ? err.message : String(err)
          )
        }
      }

      // Digest accounting (#2663). Groupable (digest-capable) targets are the
      // Slack/generic webhook URLs + Telegram chats; every non-groupable
      // channel above already dispatched inline (its count feeds
      // `immediateTargetCount`). When this finding has NO groupable target the
      // original inline commit gate runs unchanged; otherwise its commit +
      // dispatch accounting is deferred to `flushDigests()` so it reflects the
      // grouped delivery.
      const groupableTargetCount =
        groupableWebhookTargets.length + findingTelegramTargets.length
      const immediateTargetCount =
        immediateWebhookTargets.length +
        pagerDutyTargets.length +
        ntfyTargets.length +
        pushoverTargets.length +
        (opsgenieEligible ? 1 : 0) +
        (emailEligible ? 1 : 0) +
        (twilioEligible ? 1 : 0) +
        (healthchecksEligible ? 1 : 0)

      if (groupableTargetCount === 0) {
        // Unchanged inline gate: commit when there was nothing to deliver (not
        // a failure) or at least one channel succeeded; a failed delivery with
        // no successes leaves no record so the next sweep retries.
        if (immediateTargetCount === 0 || anyDelivered) {
          commit()
          if (anyDelivered) {
            alertsDispatched++
            if (decision.kind === 'recovery') recoveries++
          }
        }
        return
      }

      // Native Slack ack key (plan 37) carried for a LONE Slack send — the
      // grouped flush rebuilds the ack blocks only when a Slack target's bucket
      // has exactly one finding (a digest of many can't carry per-finding acks).
      const slackAckKey: WebhookDigestEntry['slackAck'] =
        decision.kind !== 'recovery' &&
        (effective === 'warning' || effective === 'critical') &&
        isSlackAppConfigured()
          ? { hostId, ruleId, severity: effective }
          : undefined

      const webhookEntries: BufferedDigestEntry[] = groupableWebhookTargets.map(
        (url) => ({
          kind: 'webhook',
          url,
          text,
          payload: webhookPayload,
          ...(detectAdapter(url).id === 'slack' && slackAckKey
            ? { slackAck: slackAckKey }
            : {}),
        })
      )
      const telegramEntries: BufferedDigestEntry[] = findingTelegramTargets.map(
        (t) => ({
          kind: 'telegram',
          botToken: t.botToken,
          chatId: t.chatId,
          payload: t.payload,
        })
      )

      // Time-window digest mode (#2663): buffer NON-critical, non-recovery
      // findings for a later flush; criticals + recoveries always dispatch this
      // pass (grouped in-pass). Only when the buffer WRITE succeeds do we defer
      // — a missing/failed D1 store falls back to immediate in-pass grouping
      // (fail-open). Buffering commits the finding's dedup now (the message is
      // queued) so the next sweep does not re-buffer the same condition.
      const shouldBuffer =
        digestWindowMs > 0 &&
        effective !== 'critical' &&
        decision.kind !== 'recovery'
      if (shouldBuffer) {
        const buffered = await bufferDigestEntries(
          SWEEP_ROUTING_OWNER_ID,
          [...webhookEntries, ...telegramEntries],
          Date.now() + digestWindowMs
        )
        if (buffered) {
          digestBuffered += webhookEntries.length + telegramEntries.length
          commit()
          if (anyDelivered) {
            alertsDispatched++
            if (decision.kind === 'recovery') recoveries++
          }
          return
        }
      }

      // In-pass grouping: enqueue the entries, deferring commit + accounting to
      // `flushDigests()` (all entries of this finding share one pending record,
      // so its dedup commits exactly once).
      const pending: PendingDigestCommit = {
        decision,
        commit,
        immediateTargetCount,
        immediateDelivered: anyDelivered,
        groupableTargetCount,
        groupableDelivered: false,
        committed: false,
      }
      for (const entry of webhookEntries) {
        if (entry.kind !== 'webhook') continue
        webhookDigestEntries.push({
          url: entry.url,
          text: entry.text,
          payload: entry.payload,
          slackAck: entry.slackAck,
          pending,
        })
      }
      for (const t of findingTelegramTargets) {
        telegramDigestEntries.push({
          botToken: t.botToken,
          chatId: t.chatId,
          payload: t.payload,
          pending,
        })
      }
      return
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

  /**
   * Record ONE history row for a flushed group (#2663): a lone finding
   * (bucket size 1) records the normal per-finding event via
   * {@link buildAlertEventRecord} (with its real decision, so an in-pass single
   * send is byte-identical to before this feature); a digest of ≥2 records ONE
   * `decisionKind: 'digest'` row that references every folded-in finding. A
   * time-window-flushed lone entry has no live decision (`pending === null`), so
   * it falls back to a synthesized `'digest'` row. Best-effort — never throws.
   */
  async function recordDigestHistory(
    entries: {
      payload: AlertPayload
      pending: PendingDigestCommit | null
    }[],
    channel: string,
    result: WebhookResult
  ): Promise<void> {
    try {
      if (entries.length === 1) {
        const only = entries[0]
        if (only.pending) {
          await recordAlertEvent(
            buildAlertEventRecord({
              hostId: only.payload.hostId,
              hostLabel: only.payload.hostLabel,
              ruleId: only.payload.metric,
              decision: only.pending.decision,
              value: only.payload.value,
              delivered: result.ok,
              error: result.error,
              channel,
            })
          )
          return
        }
        await recordAlertEvent({
          eventTime: new Date().toISOString(),
          hostId: only.payload.hostId,
          hostLabel: only.payload.hostLabel,
          rule: only.payload.metric,
          severity: only.payload.severity,
          prevSeverity: null,
          decisionKind: 'digest',
          delivered: result.ok,
          error: result.ok ? null : (result.error ?? 'digest dispatch failed'),
          value: only.payload.value,
          channel,
        })
        return
      }

      const summary = summarizeDigest(entries.map((e) => e.payload))
      await recordAlertEvent({
        eventTime: new Date().toISOString(),
        hostId: entries[0].payload.hostId,
        hostLabel: entries[0].payload.hostLabel,
        rule: 'digest',
        severity: summary.topSeverity,
        prevSeverity: null,
        decisionKind: 'digest',
        delivered: result.ok,
        error: result.ok ? null : (result.error ?? 'digest dispatch failed'),
        value: null,
        channel,
        findingRefs: entries.map(
          (e) => `${e.payload.hostId}:${e.payload.metric}`
        ),
      })
    } catch (err) {
      debug(
        '[health-sweep] digest alert-history record failed',
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  /**
   * Flush every buffered groupable delivery (#2663), grouping by target so a
   * target that received >1 finding this pass gets ONE combined message. Then
   * commit + count each in-pass finding exactly once (shared `pending` record),
   * gated on whether ANY of its channels — immediate or grouped — delivered.
   */
  async function flushDigests(): Promise<void> {
    // Webhook targets grouped by URL.
    const byUrl = new Map<string, WebhookDigestEntry[]>()
    for (const entry of webhookDigestEntries) {
      const list = byUrl.get(entry.url)
      if (list) list.push(entry)
      else byUrl.set(entry.url, [entry])
    }
    for (const [url, entries] of byUrl) {
      const adapterId = detectAdapter(url).id
      let body: unknown
      if (entries.length === 1) {
        const only = entries[0]
        // A lone Slack send keeps its native-app ack blocks (plan 37); a digest
        // of many cannot carry per-finding acks, so it stays plain.
        const slackBlocks =
          adapterId === 'slack' && only.slackAck
            ? buildAlertBlocksWithAck(
                {
                  severity: only.slackAck.severity,
                  hostLabel: only.payload.hostLabel,
                  hostId: only.payload.hostId,
                  metric: only.payload.metric,
                  value: only.payload.value,
                  title: only.payload.title,
                  label: only.payload.label,
                  timestamp: only.payload.timestamp,
                },
                only.slackAck
              )
            : undefined
        body = buildWebhookDispatchBody({
          url,
          text: only.text,
          payload: only.payload,
          slackBlocks,
        }).body
      } else {
        body = buildWebhookDigestDispatchBody({
          url,
          payloads: entries.map((e) => e.payload),
        }).body
      }
      const result = await postWebhook(url, body)
      if (result.ok) {
        for (const e of entries) {
          if (e.pending) e.pending.groupableDelivered = true
        }
      }
      await recordDigestHistory(entries, adapterId, result)
    }

    // Telegram targets grouped by (botToken, chatId). Sent through `postWebhook`
    // to the fixed Bot API endpoint (same fail-open transport as every webhook).
    const byChat = new Map<string, TelegramDigestEntry[]>()
    for (const entry of telegramDigestEntries) {
      const key = `${entry.botToken}${entry.chatId}`
      const list = byChat.get(key)
      if (list) list.push(entry)
      else byChat.set(key, [entry])
    }
    for (const entries of byChat.values()) {
      const first = entries[0]
      const config = { token: first.botToken, chatId: first.chatId }
      const body =
        entries.length === 1
          ? buildTelegramBody(first.payload, config)
          : buildTelegramDigestBody(
              entries.map((e) => e.payload),
              config
            )
      const result = await postWebhook(
        telegramSendMessageUrl(first.botToken),
        body
      )
      if (result.ok) {
        for (const e of entries) {
          if (e.pending) e.pending.groupableDelivered = true
        }
      }
      await recordDigestHistory(entries, 'telegram', result)
    }

    // Commit + count each distinct in-pass finding once. Buffered entries have
    // no `pending` (already committed when they were parked), so they only
    // deliver here — no double commit/count.
    const pendings = new Set<PendingDigestCommit>()
    for (const e of webhookDigestEntries) if (e.pending) pendings.add(e.pending)
    for (const e of telegramDigestEntries)
      if (e.pending) pendings.add(e.pending)
    for (const pending of pendings) {
      if (pending.committed) continue
      pending.committed = true
      const total = pending.immediateTargetCount + pending.groupableTargetCount
      const delivered = pending.immediateDelivered || pending.groupableDelivered
      if (total === 0 || delivered) {
        pending.commit()
        if (delivered) {
          alertsDispatched++
          if (pending.decision.kind === 'recovery') recoveries++
        }
      }
    }
  }

  for (const config of configs) {
    const name = hostLabel(config)
    let checksRun = 0
    let errored = 0
    let skipped = 0

    const tables = await getExistingSystemTables(config.id)

    // Per-host base rule results, keyed by rule id — feeds compound rules
    // below. Populated for every rule that actually ran (regardless of
    // severity), so a compound predicate can read the raw value/severity of
    // a healthy base rule too (e.g. `readonly-replicas` at 0).
    const perHostResults: Record<string, CompoundRuleInput> = {}

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

        if (alertingEnabled) {
          await dispatchFinding({
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
    for (const compound of orderedCompoundRules) {
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
            label: compound.formatLabel
              ? compound.formatLabel(inputs)
              : severity,
          })
        }
        if (alertingEnabled) {
          await dispatchFinding({
            hostId: config.id,
            hostName: name,
            ruleId: compound.id,
            ruleType: 'compound',
            ruleTitle: compound.title,
            severity,
            value: null,
            label: compound.formatLabel
              ? compound.formatLabel(inputs)
              : severity,
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

  // Postgres AI insights (cross-source, env-gated). Runs AFTER the ClickHouse
  // loop and only when CHM_FEATURE_POSTGRES_SOURCE is on — fail-closed, exactly
  // like the agent's Postgres tools. Iterates the env-configured Postgres
  // sources (`POSTGRES_*` lists) and generates insights per source. Wrapped so a
  // Postgres failure can never break the ClickHouse sweep.
  if (process.env.CHM_FEATURE_POSTGRES_SOURCE === 'true') {
    try {
      const { getPostgresConfigs } = await import('@chm/postgres-client')
      const pgConfigs = getPostgresConfigs()
      for (const pgConfig of pgConfigs) {
        try {
          const pgInsights = await generatePostgresInsights(pgConfig.id)
          insightsGenerated += pgInsights.length
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
  }

  // Flush all buffered groupable deliveries (#2663): send one combined message
  // per target that received >1 finding, then commit + count each deferred
  // finding. Runs after every host so grouping spans the whole pass.
  await flushDigests()

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
    maintenanceSuppressed,
    quietHoursSuppressed,
    ackedSuppressed,
    recoveries,
    digestBuffered,
    digestFlushed,
    emailsDispatched,
    insightsGenerated,
    hosts,
    findings,
  }
}
