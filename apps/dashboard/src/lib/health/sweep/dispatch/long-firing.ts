/**
 * Opt-in daily digest of long-firing alerts (#4049).
 *
 * Off unless `HEALTH_ALERT_LONG_FIRING_DIGEST_HOURS` (or `alerts.yaml`
 * `repeat.longFiringDigestHours`) is set. An alert still firing after that many
 * hours is listed in ONE summary message per channel per UTC day, through the
 * same digest bodies the grouped sweep dispatch uses.
 *
 * Idempotency lives in the alert-state store: after a channel's digest is
 * delivered, a marker record (`LONG_FIRING_MARKER_HOST_ID`, one per channel) is
 * stamped with the send time. The marker rides the normal D1 hydrate/flush, so
 * a second sweep, a retry, or a restart on the same day finds it and sends
 * nothing; a failed send leaves no marker and is retried next sweep.
 */

import type { AlertRuleSeverity } from '@/lib/alerting/rule-registry'
import type { AlertPayload } from './../../adapters'
import type { AlertChannelId } from './../../alert-channel-settings'
import type { AlertRoute } from './../../alert-routing'
import type { AlertStateRecord } from './../../alert-state-store'
import type { SweepContext } from './../resolve-config'

import {
  buildTelegramDigestBody,
  buildWebhookDigestDispatchBody,
  detectAdapter,
} from './../../adapters'
import { resolveChannelDelivery } from './../../alert-channel-settings'
import { recordAlertEvent } from './../../alert-history-store'
import { resolveTargets, resolveTelegramTargets } from './../../alert-routing'
import { flushAlertState } from './../../alert-state-persist'
import { alertStateStore } from './../../alert-state-store'
import { telegramSendMessageUrl } from './../../telegram-dispatch'
import {
  isAckGated,
  isMaintenanceGated,
  isQuietHoursGated,
  isRuleMuted,
} from './../suppression'
import { partitionWebhookTargets } from './channels/webhook-fanout'
import { postWebhook, postWebhookTarget } from './webhook-post'
import { debug } from '@chm/logger'

/**
 * Host id of the marker records. Negative so it can never collide with an
 * env-configured host; `readAlertStates` hides it from the state UI.
 */
export const LONG_FIRING_MARKER_HOST_ID = -1

const MARKER_RULE_PREFIX = 'long-firing-digest:'

/** What the dispatcher knows about one finding when it is evaluated. */
export interface LongFiringCandidate {
  hostId: number
  hostName: string
  ruleId: string
  ruleType: string
  ruleTitle: string
  label: string
  /** Severity after the global floor; `ok` = not firing. */
  effective: AlertRuleSeverity
  value: number | null
  /** The state record from BEFORE this sweep's evaluation. */
  previous: AlertStateRecord | undefined
  identity?: Pick<AlertPayload, 'instanceName' | 'dashboardUrl' | 'metadata'>
}

interface ChannelBucket {
  /** Non-secret marker key; hashes the destination. */
  channelKey: string
  channel: string
  /** Send the digest, returning whether the destination accepted it. */
  send: (payloads: AlertPayload[]) => Promise<{ ok: boolean; error?: string }>
  payloads: AlertPayload[]
}

export interface LongFiringDigest {
  collect: (candidate: LongFiringCandidate) => void
  flush: () => Promise<void>
}

/** UTC calendar day of an epoch-ms time, `YYYY-MM-DD`. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Short stable hash (FNV-1a) so a marker key never carries a URL or token. */
function shortHash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const markerKey = (channelKey: string): string =>
  `${LONG_FIRING_MARKER_HOST_ID}:${MARKER_RULE_PREFIX}${channelKey}`

/** Whether this channel already got its digest on `now`'s UTC day. */
function alreadySentToday(channelKey: string, now: number): boolean {
  const marker = alertStateStore.get(markerKey(channelKey))
  return marker !== undefined && utcDay(marker.notifiedAt) === utcDay(now)
}

export function createLongFiringDigest(ctx: SweepContext): LongFiringDigest {
  const thresholdMs = ctx.longFiringDigestMs ?? 0
  const buckets = new Map<string, ChannelBucket>()

  function bucketFor(
    channelKey: string,
    channel: string,
    send: ChannelBucket['send']
  ): ChannelBucket {
    let bucket = buckets.get(channelKey)
    if (!bucket) {
      bucket = { channelKey, channel, send, payloads: [] }
      buckets.set(channelKey, bucket)
    }
    return bucket
  }

  function collect(c: LongFiringCandidate): void {
    if (thresholdMs <= 0) return
    const { previous, effective } = c
    if (
      effective === 'ok' ||
      !previous ||
      previous.severity === 'ok' ||
      previous.firstFiredAt === undefined
    ) {
      return
    }
    const now = Date.now()
    const openMs = now - previous.firstFiredAt
    if (openMs < thresholdMs) return

    // The same gates a notification passes: a muted, maintained, quiet or
    // acked alert is not listed in a digest either.
    if (isRuleMuted(ctx.mutedRules, c.ruleId)) return
    if (
      isMaintenanceGated({
        notify: true,
        windows: ctx.windows,
        hostId: c.hostId,
        now,
      })
    )
      return
    if (
      isQuietHoursGated({
        notify: true,
        isRecovery: false,
        effective,
        quietHours: ctx.quietHours,
        now,
      })
    )
      return
    if (
      isAckGated({
        notify: true,
        isRecovery: false,
        acks: ctx.acks,
        hostId: c.hostId,
        ruleId: c.ruleId,
        now,
      })
    )
      return

    const payload: AlertPayload = {
      severity: effective as 'warning' | 'critical',
      hostLabel: c.hostName,
      hostId: c.hostId,
      metric: c.ruleId,
      value: c.value,
      title: c.ruleTitle,
      label: c.label,
      timestamp: new Date(now).toISOString(),
      stillOpenMs: openMs,
      ...(previous.firstValue !== undefined && {
        previousValue: previous.firstValue,
      }),
      ...c.identity,
    }

    // Same per-channel floor and route matching a live alert uses.
    const channelPasses = (
      channelId: AlertChannelId,
      routeMinSeverity: 'warning' | 'critical' | null = null
    ): boolean =>
      resolveChannelDelivery({
        severity: effective as 'warning' | 'critical',
        globalMinSeverity: ctx.settings.minSeverity,
        channel: ctx.channelSettings[channelId],
        routeMinSeverity,
      })
    const accept = (route: AlertRoute): boolean =>
      channelPasses(
        route.provider === 'telegram' ? 'telegram' : 'webhook',
        route.minSeverity
      )
    const target = {
      ruleId: c.ruleId,
      ruleType: c.ruleType,
      hostId: c.hostId,
      hostName: c.hostName,
    }

    const webhookTargets = resolveTargets(
      ctx.routes,
      target,
      channelPasses('webhook')
        ? {
            url: ctx.channels.webhookUrl,
            trusted: ctx.channels.webhookUrlTrusted,
          }
        : null,
      { accept }
    )
    for (const t of partitionWebhookTargets(webhookTargets).groupable) {
      const adapterId = detectAdapter(t.url).id
      bucketFor(`webhook:${adapterId}:${shortHash(t.url)}`, adapterId, (list) =>
        postWebhookTarget(
          t,
          buildWebhookDigestDispatchBody({ url: t.url, payloads: list }).body
        )
      ).payloads.push(payload)
    }

    for (const t of resolveTelegramTargets(
      ctx.routes,
      target,
      channelPasses('telegram') ? ctx.channels.telegram : null,
      { accept }
    )) {
      bucketFor(
        `telegram:${shortHash(`${t.botToken}:${t.chatId}`)}`,
        'telegram',
        (list) =>
          postWebhook(
            telegramSendMessageUrl(t.botToken),
            buildTelegramDigestBody(list, {
              token: t.botToken,
              chatId: t.chatId,
            })
          )
      ).payloads.push(payload)
    }
  }

  async function flush(): Promise<void> {
    if (buckets.size === 0) return
    const now = Date.now()
    let stamped = false
    for (const bucket of buckets.values()) {
      if (alreadySentToday(bucket.channelKey, now)) continue
      // Longest-open first.
      const payloads = [...bucket.payloads].sort(
        (a, b) => (b.stillOpenMs ?? 0) - (a.stillOpenMs ?? 0)
      )
      const result = await bucket.send(payloads)
      if (result.ok) {
        // Stamp before anything else can fail: this is what stops a retry or
        // the next sweep from sending a second digest today.
        alertStateStore.set(markerKey(bucket.channelKey), {
          severity: 'warning',
          updatedAt: now,
          notifiedAt: now,
        })
        stamped = true
      }
      try {
        await recordAlertEvent({
          eventTime: new Date().toISOString(),
          hostId: payloads[0].hostId,
          hostLabel: payloads[0].hostLabel,
          rule: 'long-firing-digest',
          severity: payloads[0].severity,
          prevSeverity: null,
          decisionKind: 'digest',
          delivered: result.ok,
          error: result.ok ? null : (result.error ?? 'digest dispatch failed'),
          value: null,
          channel: bucket.channel,
          findingRefs: payloads.map((p) => `${p.hostId}:${p.metric}`),
        })
      } catch (err) {
        debug(
          '[health-sweep] long-firing digest history record failed',
          err instanceof Error ? err.message : String(err)
        )
      }
    }
    // Persist the markers now rather than at the end of the tick, so a crash
    // right after the send cannot cause a second digest on restart.
    if (stamped && ctx.alertingEnabled) await flushAlertState(alertStateStore)
  }

  return { collect, flush }
}
