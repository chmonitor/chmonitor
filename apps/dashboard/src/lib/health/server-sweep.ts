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
import type { AlertEventRecord } from './alert-history-store'
import type { AlertRoute } from './alert-routing'
import type { AlertDecision } from './alert-state-store'

import { buildPagerDutyBody, detectAdapter } from './adapters'
import { recordAlertEvent } from './alert-history-store'
import {
  listRoutes,
  resolvePagerDutyTargets,
  resolveTargets,
} from './alert-routing'
import { alertStateStore, evaluateAlert } from './alert-state-store'
import {
  getPagerDutyFallbackRoutingKey,
  PAGERDUTY_EVENTS_API_URL,
} from './pagerduty-config'
import {
  getServerAlertConfig,
  getServerAlertCooldownMs,
  getServerThresholdOverrides,
} from './server-alert-config'
import { fetchData, getClickHouseConfigs } from '@chm/clickhouse-client'
import { debug, error } from '@chm/logger'
import { registerBuiltinRules } from '@/lib/alerting/builtin-rules'
import {
  compoundRuleRegistry,
  topoSortCompound,
} from '@/lib/alerting/compound-rules'
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
  minSeverity: 'warning' | 'critical'
  hostsChecked: number
  totalChecks: number
  totalFindings: number
  alertsDispatched: number
  /** Alerts suppressed by the dedup state store (already-firing conditions). */
  alertsSuppressed: number
  /** Recovery notifications sent for conditions that returned to ok. */
  recoveries: number
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
 * POST an alert to the configured webhook using the EXACT payload shape the
 * `/api/v1/health/webhook` proxy forwards upstream (`{ text, content: text }`),
 * so Slack (`text`) and Discord (`content`) both render it. Server-side, no CORS
 * proxy needed — we post directly to the operator-configured webhook URL.
 */
async function postWebhook(url: string, text: string): Promise<WebhookResult> {
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
 *
 * Disabled (or no webhook URL and no routes) → rules still run, alerts are
 * skipped.
 */
export async function runHealthSweep(): Promise<SweepSummary> {
  const ranAt = new Date().toISOString()
  const settings = getServerAlertConfig()
  const webhookConfigured = Boolean(settings.webhookUrl)
  const routes: AlertRoute[] = await listRoutes(SWEEP_ROUTING_OWNER_ID)
  const pagerDutyFallbackKey = getPagerDutyFallbackRoutingKey()
  const canDispatch =
    settings.webhookEnabled &&
    (webhookConfigured || routes.length > 0 || Boolean(pagerDutyFallbackKey))
  const minRank = SEVERITY_ORDER[settings.minSeverity]
  const cooldownMs = getServerAlertCooldownMs()

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

  const hosts: SweepHostSummary[] = []
  const findings: SweepFinding[] = []
  let insightsGenerated = 0
  let alertsDispatched = 0
  let alertsSuppressed = 0
  let recoveries = 0

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
    } = params
    const effective: Severity =
      SEVERITY_ORDER[severity] >= minRank ? severity : 'ok'
    const { decision, commit } = evaluateAlert(alertStateStore, {
      hostId,
      ruleId,
      severity: effective,
      cooldownMs,
    })
    if (decision.notify) {
      const text =
        decision.kind === 'recovery'
          ? `[RECOVERY] ${ruleTitle} — resolved (host ${name})`
          : `[${effective.toUpperCase()}] ${ruleTitle} — ${label} (host ${name})`

      // Fan out to every matched route's channel (plan 30), falling back to
      // the legacy global webhook when nothing matches (see `alert-routing.ts`).
      // Dedup (`evaluateAlert`) already ran ONCE above for this finding —
      // fan-out never multiplies cooldown state, it only multiplies where the
      // single decision is sent.
      const targets = resolveTargets(
        routes,
        { ruleId, ruleType, hostId, hostName: name },
        settings.webhookUrl
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
        pagerDutyFallbackKey
      )

      let anyDelivered = false
      for (const url of targets) {
        const result = await postWebhook(url, text)
        if (result.ok) anyDelivered = true

        // Best-effort audit trail per channel — recorded on both success and
        // failure so a slow or failing D1 write can never delay or drop the
        // alert that was just dispatched. recordAlertEvent already never
        // throws; the try/catch here is defense-in-depth, mirroring the
        // generateInsights call below. detectAdapter picks the per-URL channel
        // label (plan 26), so a fan-out to mixed Slack/Discord/Opsgenie
        // destinations is audited per its own adapter.
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
              channel: detectAdapter(url).id,
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

      // Persist "notified" only when there was nothing to deliver (no
      // targets at all across every channel — not a failure) or at least one
      // channel succeeded. A failed delivery with no successes leaves no
      // record, so the next sweep retries instead of suppressing.
      if (targets.length + pagerDutyTargets.length === 0 || anyDelivered) {
        commit()
        if (anyDelivered) {
          alertsDispatched++
          if (decision.kind === 'recovery') recoveries++
        }
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
        const severity = classifyValue(value, thresholds)
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

        if (canDispatch) {
          await dispatchFinding({
            hostId: config.id,
            hostName: name,
            ruleId: rule.id,
            ruleTitle: rule.title,
            severity,
            value,
            ruleType: rule.type,
            label: rule.formatLabel ? rule.formatLabel(value) : String(value),
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
        if (canDispatch) {
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

  return {
    ranAt,
    enabled: settings.webhookEnabled,
    webhookConfigured,
    minSeverity: settings.minSeverity,
    hostsChecked: configs.length,
    totalChecks: hosts.reduce((sum, h) => sum + h.checksRun, 0),
    totalFindings: findings.length,
    alertsDispatched,
    alertsSuppressed,
    recoveries,
    insightsGenerated,
    hosts,
    findings,
  }
}
