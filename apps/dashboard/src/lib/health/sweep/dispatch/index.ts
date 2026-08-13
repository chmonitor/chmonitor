/**
 * Alert dispatch for the health sweep (#2884).
 *
 * Owns everything between "a rule classified a finding" and "the operator was
 * notified": the dedup decision (`evaluateAlert`), the suppression gates
 * (maintenance / quiet hours / ACK — see `../suppression.ts`), the per-channel
 * fan-out (webhook routes, PagerDuty, Opsgenie, email, Telegram, ntfy, Twilio,
 * Pushover, healthchecks.io, and the outbound webhook-subscriptions bus), the
 * digest grouping/buffering (#2663), and the alert-history audit trail.
 *
 * This module is the ORCHESTRATOR only (#2938): it runs the gates, resolves
 * every channel's targets, then calls one `dispatch*Channel` per channel in the
 * historical order and hands the outcome to `./digest.ts`. The channels live in
 * `./channels/*`, the shared transport in `./webhook-post.ts`, and the audit
 * trail in `./alert-event-record.ts`.
 *
 * {@link createDispatcher} returns a closure pair (`dispatchFinding` +
 * `flushDigests`) sharing one mutable {@link DispatchCounters} record and the
 * in-pass digest buckets — the same closure structure the sweep had inline, so
 * commit/accounting semantics are unchanged: a finding with groupable targets
 * defers its dedup `commit()` to the flush, one shared `pending` record per
 * finding guaranteeing it commits exactly once.
 */

import type { AlertPayload } from './../../adapters'
import type {
  AlertChannelId,
  AlertSeverityFloor,
} from './../../alert-channel-settings'
import type { AlertRoute, AlertRouteProvider } from './../../alert-routing'
import type { SweepContext } from './../resolve-config'
import type { FindingContext } from './finding-context'
import type {
  DispatchCounters,
  Dispatcher,
  DispatchFindingParams,
} from './types'

import { clearAck } from './../../alert-ack-store'
import { resolveChannelDelivery } from './../../alert-channel-settings'
import { recordAlertEvent } from './../../alert-history-store'
import {
  resolveNtfyTargets,
  resolvePagerDutyTargets,
  resolvePushoverTargets,
  resolveTargets,
  resolveTelegramTargets,
} from './../../alert-routing'
import { alertStateStore, evaluateAlert } from './../../alert-state-store'
import { dispatchDedupedAlertEvent } from './../../alert-webhook-events'
import {
  activeQuietWindow,
  markQuietSuppression,
  quietWindowEndMs,
  takeDueCatchUp,
} from './../../quiet-hours'
import { SWEEP_ACK_OWNER_ID } from './../resolve-config'
import {
  effectiveSeverity,
  isAckGated,
  isMaintenanceGated,
  isQuietHoursGated,
  meetsMinSeverity,
} from './../suppression'
import { dispatchEmailChannel } from './channels/email'
import { dispatchHealthchecksChannel } from './channels/healthchecks'
import { dispatchNtfyChannel } from './channels/ntfy'
import { dispatchOpsgenieChannel } from './channels/opsgenie'
import { dispatchPagerDutyChannel } from './channels/pagerduty'
import { dispatchPushoverChannel } from './channels/pushover'
import { dispatchTelegramChannel } from './channels/telegram'
import { dispatchTwilioChannel } from './channels/twilio'
import {
  dispatchWebhookFanoutChannel,
  partitionWebhookTargets,
} from './channels/webhook-fanout'
import { createDigestPipeline } from './digest'
import { debug } from '@chm/logger'
import { formatDuration } from '@/lib/utils'

export type {
  DispatchCounters,
  Dispatcher,
  DispatchFindingParams,
} from './types'

export { buildAlertEventRecord } from './alert-event-record'
export { postPagerDutyEvent, postWebhook } from './webhook-post'

/** Which per-channel override (#2661) governs a route of each provider. */
const PROVIDER_CHANNEL: Record<AlertRouteProvider, AlertChannelId> = {
  webhook: 'webhook',
  pagerduty: 'pagerduty',
  telegram: 'telegram',
  ntfy: 'ntfy',
  pushover: 'pushover',
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

  // Digest grouping (#2663) — Slack/generic-webhook/Telegram sends buffer here
  // and flush once per tick; see `./digest.ts`.
  const digest = await createDigestPipeline(ctx, counters)

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

    // Everything a channel needs to know about this finding, assembled once.
    const finding: FindingContext = {
      hostId,
      hostLabel: name,
      ruleId,
      ruleTitle,
      label,
      value,
      warnThreshold,
      critThreshold,
      effective,
      isRecovery,
      decision,
      text,
    }

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

    // Digest partition (#2663): the digest-capable URLs (Slack / generic
    // webhooks) are grouped and flushed later; the rest send inline now.
    const {
      immediate: immediateWebhookTargets,
      groupable: groupableWebhookTargets,
    } = partitionWebhookTargets(targets)

    // -----------------------------------------------------------------------
    // Per-channel fan-out. The ORDER below is behaviour: it is the historical
    // inline order, and each channel's own `anyDelivered` contribution feeds
    // the commit gate at the end.
    // -----------------------------------------------------------------------
    let anyDelivered = false

    const webhookDelivered = await dispatchWebhookFanoutChannel(
      finding,
      immediateWebhookTargets,
      webhookPayload
    )
    if (webhookDelivered) anyDelivered = true

    const pagerDutyDelivered = await dispatchPagerDutyChannel(
      finding,
      pagerDutyTargets
    )
    if (pagerDutyDelivered) anyDelivered = true

    if (opsgenieConfig && opsgenieEligible) {
      const ok = await dispatchOpsgenieChannel(finding, opsgenieConfig)
      if (ok) anyDelivered = true
    }

    if (emailConfig && emailEligible) {
      const ok = await dispatchEmailChannel(finding, emailConfig)
      if (ok) {
        anyDelivered = true
        counters.emailsDispatched++
      }
    }

    // Telegram is digest-capable: this only collects the entries, the grouped
    // flush sends them.
    const findingTelegramTargets = dispatchTelegramChannel(
      finding,
      telegramTargets
    )

    const ntfyDelivered = await dispatchNtfyChannel(finding, ntfyTargets)
    if (ntfyDelivered) anyDelivered = true

    const twilio = await dispatchTwilioChannel(finding, twilioConfig)
    if (twilio.delivered) anyDelivered = true

    const pushoverDelivered = await dispatchPushoverChannel(
      finding,
      pushoverTargets
    )
    if (pushoverDelivered) anyDelivered = true

    if (healthchecksEligible) {
      const ok = await dispatchHealthchecksChannel(finding, healthchecksUrl)
      if (ok) anyDelivered = true
    }

    // Every non-groupable channel above already dispatched inline; its count
    // feeds the digest layer's commit gate.
    const immediateTargetCount =
      immediateWebhookTargets.length +
      pagerDutyTargets.length +
      ntfyTargets.length +
      pushoverTargets.length +
      (opsgenieEligible ? 1 : 0) +
      (emailEligible ? 1 : 0) +
      (twilio.eligible ? 1 : 0) +
      (healthchecksEligible ? 1 : 0)

    await digest.settleFinding({
      finding,
      commit,
      anyDelivered,
      groupableWebhookTargets,
      findingTelegramTargets,
      immediateTargetCount,
      webhookPayload,
    })
  }

  return { dispatchFinding, flushDigests: digest.flushDigests, counters }
}
