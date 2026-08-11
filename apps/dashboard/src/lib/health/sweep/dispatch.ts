/**
 * Alert dispatch for the health sweep (#2884).
 *
 * Owns everything between "a rule classified a finding" and "the operator was
 * notified": the dedup decision (`evaluateAlert`), the suppression gates
 * (maintenance / quiet hours / ACK — see `./suppression.ts`), the per-channel
 * fan-out (webhook routes, PagerDuty, Opsgenie, email, Telegram, ntfy, Twilio,
 * Pushover, healthchecks.io, and the outbound webhook-subscriptions bus), the
 * digest grouping/buffering (#2663), and the alert-history audit trail.
 *
 * {@link createDispatcher} returns a closure pair (`dispatchFinding` +
 * `flushDigests`) sharing one mutable {@link DispatchCounters} record and the
 * in-pass digest buckets — the same closure structure the sweep had inline, so
 * commit/accounting semantics are unchanged: a finding with groupable targets
 * defers its dedup `commit()` to the flush, one shared `pending` record per
 * finding guaranteeing it commits exactly once.
 */

import type { AlertPayload, PagerDutyEventBody } from './../adapters'
import type { AlertSeverity } from './../adapters/types'
import type {
  AlertChannelId,
  AlertSeverityFloor,
} from './../alert-channel-settings'
import type { AlertEventRecord } from './../alert-history-store'
import type { AlertRoute, AlertRouteProvider } from './../alert-routing'
import type { AlertDecision } from './../alert-state-store'
import type { SweepContext } from './resolve-config'
import type { Severity } from './suppression'

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
} from './../adapters'
import { clearAck } from './../alert-ack-store'
import { resolveChannelDelivery } from './../alert-channel-settings'
import {
  type BufferedDigestEntry,
  bufferDigestEntries,
  takeDueDigestEntries,
} from './../alert-digest-buffer-store'
import { recordAlertEvent } from './../alert-history-store'
import {
  resolveNtfyTargets,
  resolvePagerDutyTargets,
  resolvePushoverTargets,
  resolveTargets,
  resolveTelegramTargets,
} from './../alert-routing'
import { alertStateStore, evaluateAlert } from './../alert-state-store'
import { dispatchDedupedAlertEvent } from './../alert-webhook-events'
import { sendAlertEmail } from './../email-transport'
import { dispatchHealthchecks } from './../healthchecks-dispatch'
import { dispatchNtfy } from './../ntfy-dispatch'
import { dispatchOpsgenie } from './../opsgenie-dispatch'
import { PAGERDUTY_EVENTS_API_URL } from './../pagerduty-config'
import { dispatchPushover } from './../pushover-dispatch'
import {
  activeQuietWindow,
  markQuietSuppression,
  quietWindowEndMs,
  takeDueCatchUp,
} from './../quiet-hours'
import { telegramSendMessageUrl } from './../telegram-dispatch'
import { dispatchTwilio } from './../twilio-dispatch'
import { debug, error } from '@chm/logger'
import { buildAlertBlocksWithAck } from '@/lib/slack/blocks'
import { isSlackAppConfigured } from '@/lib/slack/config'
import { formatDuration } from '@/lib/utils'
import { SWEEP_ACK_OWNER_ID, SWEEP_ROUTING_OWNER_ID } from './resolve-config'
import {
  effectiveSeverity,
  isAckGated,
  isMaintenanceGated,
  isQuietHoursGated,
  meetsMinSeverity,
  SEVERITY_ORDER,
} from './suppression'

/** Which per-channel override (#2661) governs a route of each provider. */
const PROVIDER_CHANNEL: Record<AlertRouteProvider, AlertChannelId> = {
  webhook: 'webhook',
  pagerduty: 'pagerduty',
  telegram: 'telegram',
  ntfy: 'ntfy',
  pushover: 'pushover',
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
export async function postWebhook(
  url: string,
  body: unknown
): Promise<WebhookResult> {
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
export async function postPagerDutyEvent(
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

export interface DispatchFindingParams {
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
}

/** Every dispatch-side counter the sweep summary reports. */
export interface DispatchCounters {
  alertsDispatched: number
  alertsSuppressed: number
  maintenanceSuppressed: number
  quietHoursSuppressed: number
  ackedSuppressed: number
  recoveries: number
  emailsDispatched: number
  digestBuffered: number
  digestFlushed: number
}

export interface Dispatcher {
  dispatchFinding: (params: DispatchFindingParams) => Promise<void>
  flushDigests: () => Promise<void>
  counters: DispatchCounters
}

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

/**
 * Build the sweep's dispatcher for one tick. Seeds the digest buckets with any
 * time-window-buffered entries whose window has closed (a destructive read —
 * done exactly once per tick, gated on digest mode being on).
 */
export async function createDispatcher(ctx: SweepContext): Promise<Dispatcher> {
  const { settings, routes, channelSettings, windows, quietHours, acks } = ctx
  const webhookUrl = ctx.channels.webhookUrl
  const opsgenieConfig = ctx.channels.opsgenie
  const emailConfig = ctx.channels.email
  const telegramFallback = ctx.channels.telegram
  const ntfyFallback = ctx.channels.ntfy
  const twilioConfig = ctx.channels.twilio
  const pushoverFallback = ctx.channels.pushover
  const healthchecksUrl = ctx.channels.healthchecksUrl

  const counters: DispatchCounters = {
    alertsDispatched: 0,
    alertsSuppressed: 0,
    maintenanceSuppressed: 0,
    quietHoursSuppressed: 0,
    ackedSuppressed: 0,
    recoveries: 0,
    emailsDispatched: 0,
    digestBuffered: 0,
    digestFlushed: 0,
  }

  // -------------------------------------------------------------------------
  // Digest grouping (#2663). Slack + generic-webhook + Telegram sends buffer
  // here so a delivery target that receives >1 finding in this pass gets ONE
  // combined message; every other channel dispatches inline (unchanged). A
  // finding that routes to any groupable target has its dedup `commit()` +
  // dispatch accounting DEFERRED to `flushDigests()` (so the commit reflects
  // the actual grouped delivery); a finding with NO groupable target keeps the
  // exact inline-commit path it had before this feature.
  // -------------------------------------------------------------------------
  const webhookDigestEntries: WebhookDigestEntry[] = []
  const telegramDigestEntries: TelegramDigestEntry[] = []

  // Time-window buffered entries whose window has closed — loaded once, merged
  // into the in-pass buckets before the flush so they group with fresh
  // findings for the same target. Best-effort ([] with no D1).
  const dueBufferedEntries = ctx.digestWindowMs
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
    counters.digestFlushed++
  }

  /**
   * Dedup + dispatch a single finding (base or compound rule) via the shared
   * webhook path. Sub-threshold severities count as 'ok' so the state store
   * only tracks conditions the operator cares about (and a drop below the
   * threshold reads as a recovery).
   */
  async function dispatchFinding(params: DispatchFindingParams): Promise<void> {
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
    const effective = effectiveSeverity(severity, settings.minSeverity)
    const ruleHysteresis =
      ctx.hysteresis.byRule[ruleId] ?? ctx.hysteresis.defaults
    const { decision, commit } = evaluateAlert(alertStateStore, {
      hostId,
      ruleId,
      severity: effective,
      cooldownMs: ctx.cooldownMs,
      minConsecutiveBreaches: ruleHysteresis.minConsecutiveBreaches,
      minConsecutiveClears: ruleHysteresis.minConsecutiveClears,
    })
    const isRecovery = decision.kind === 'recovery'

    if (
      isMaintenanceGated({
        notify: decision.notify,
        windows,
        hostId,
        now: Date.now(),
      })
    ) {
      // A maintenance window covers this host right now — suppress the
      // dispatch across every channel. The finding was already pushed to
      // `findings` and the rule already ran, so nothing about data
      // collection changes. Deliberately do NOT call `commit()`: the dedup
      // state store must stay exactly as it was (still "unknown" for a
      // brand-new condition, or still at its last-committed severity for a
      // persisting one) so the cooldown/escalation semantics are unaffected
      // once the window ends — the very next sweep after the window closes
      // re-evaluates fresh and notifies normally if the condition still holds.
      counters.alertsSuppressed++
      counters.maintenanceSuppressed++
      try {
        await recordAlertEvent({
          eventTime: new Date().toISOString(),
          hostId,
          hostLabel: name,
          rule: ruleId,
          severity: isRecovery
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
      isQuietHoursGated({
        notify: decision.notify,
        isRecovery,
        effective,
        quietHours,
        now: Date.now(),
      })
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
      counters.alertsSuppressed++
      counters.quietHoursSuppressed++
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
          severity: effective as 'warning' | 'critical',
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

    if (decision.notify && isRecovery) {
      // A resolved condition should always reach the operator — never
      // suppress a recovery — and any active ACK for it is now moot.
      // Best-effort: clearAck never throws.
      void clearAck(SWEEP_ACK_OWNER_ID, hostId, ruleId)
    } else if (
      isAckGated({
        notify: decision.notify,
        isRecovery,
        acks,
        hostId,
        ruleId,
        now: Date.now(),
      })
    ) {
      // Post-decision dispatch gate only — do NOT commit. Like the
      // maintenance-window suppression above, an acked (non-delivered)
      // notification must not start the reminder cooldown clock — otherwise a
      // short ACK (e.g. 15m) would silently suppress the next reminder until
      // the full cooldown (e.g. 60m) elapses. Once the ACK expires, the next
      // firing sweep re-evaluates fresh and delivers/commits normally.
      counters.alertsSuppressed++
      counters.ackedSuppressed++
      // TODO(27): historyStore.record({ ..., decisionKind: 'acked', delivered: false })
      return
    }

    if (!decision.notify) {
      // Non-notify decisions (dedup/de-escalation/recovery-cleared
      // bookkeeping) still commit — only the notify path gates on
      // delivery.
      commit()
      if (meetsMinSeverity(severity, settings.minSeverity)) {
        // A current finding that we chose not to re-send (deduped).
        counters.alertsSuppressed++
      }
      return
    }

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
      !isRecovery && takeDueCatchUp(hostId, ruleId, Date.now())
    // Recovery message reports the incident duration when known (#2767).
    const recoveryDuration =
      decision.incidentDurationMs !== undefined
        ? ` after ${formatDuration(decision.incidentDurationMs)}`
        : ''
    const text = isRecovery
      ? `[RECOVERY] ${ruleTitle} — resolved${recoveryDuration} (host ${name})`
      : `${isQuietCatchUp ? '[CATCH-UP] ' : ''}[${effective.toUpperCase()}] ${ruleTitle} — ${label} (host ${name})`

    // Per-channel + per-route gate (#2661). The severity a channel is judged
    // against is the finding's own severity for an alert, or the severity it
    // recovered FROM for a recovery (so a condition that never paged a
    // critical-only channel as a warning does not page it when it clears).
    const deliverSeverity: AlertSeverityFloor | null = isRecovery
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
      channelPasses('pagerduty') ? ctx.pagerDutyFallbackKey : '',
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
      severity: isRecovery ? 'recovery' : (effective as 'warning' | 'critical'),
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
        severity: isRecovery
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
      const alertSeverity: AlertSeverity = isRecovery
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
      const alertSeverity: AlertSeverity = isRecovery
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
        counters.emailsDispatched++
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
    const telegramAlertSeverity: AlertSeverity = isRecovery
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
      const alertSeverity: AlertSeverity = isRecovery
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
    const twilioTriggerSeverity: Severity = isRecovery
      ? decision.previousSeverity
      : effective
    const twilioEligible =
      twilioConfig !== null &&
      twilioTriggerSeverity !== 'ok' &&
      SEVERITY_ORDER[twilioTriggerSeverity] >=
        SEVERITY_ORDER[twilioConfig.minSeverity]
    if (twilioConfig && twilioEligible) {
      const alertSeverity: AlertSeverity = isRecovery
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
      const alertSeverity: AlertSeverity = isRecovery
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
        isRecovery ? 'recovery' : 'alert'
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
          counters.alertsDispatched++
          if (isRecovery) counters.recoveries++
        }
      }
      return
    }

    // Native Slack ack key (plan 37) carried for a LONE Slack send — the
    // grouped flush rebuilds the ack blocks only when a Slack target's bucket
    // has exactly one finding (a digest of many can't carry per-finding acks).
    const slackAckKey: WebhookDigestEntry['slackAck'] =
      !isRecovery &&
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
      ctx.digestWindowMs > 0 && effective !== 'critical' && !isRecovery
    if (shouldBuffer) {
      const buffered = await bufferDigestEntries(
        SWEEP_ROUTING_OWNER_ID,
        [...webhookEntries, ...telegramEntries],
        Date.now() + ctx.digestWindowMs
      )
      if (buffered) {
        counters.digestBuffered +=
          webhookEntries.length + telegramEntries.length
        commit()
        if (anyDelivered) {
          counters.alertsDispatched++
          if (isRecovery) counters.recoveries++
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
          counters.alertsDispatched++
          if (pending.decision.kind === 'recovery') counters.recoveries++
        }
      }
    }
  }

  return { dispatchFinding, flushDigests, counters }
}
