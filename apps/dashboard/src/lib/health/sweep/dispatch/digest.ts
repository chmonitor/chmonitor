/**
 * Digest grouping + deferred commit accounting for the sweep's dispatch
 * (#2663), extracted verbatim from `sweep/dispatch.ts` in #2938.
 *
 * Slack + generic-webhook + Telegram + native Matrix sends, plus hookshot / matrix custom
 * targets without templates (#3869, grouped by target id, in-pass only), buffer
 * here so a delivery target
 * that receives >1 finding in this pass gets ONE combined message; every other
 * channel dispatches inline (unchanged). A finding that routes to any groupable
 * target has its dedup `commit()` + dispatch accounting DEFERRED to
 * {@link DigestPipeline.flushDigests} (so the commit reflects the actual grouped
 * delivery); a finding with NO groupable target keeps the exact inline-commit
 * path it had before this feature.
 */

import type { AlertPayload } from './../../adapters'
import type { BufferedDigestEntry } from './../../alert-digest-buffer-store'
import type { WebhookTarget } from './../../alert-routing'
import type { AlertDecision } from './../../alert-state-store'
import type { EffectiveCustomWebhookTarget } from './../../custom-webhook-config'
import type { SweepContext } from './../resolve-config'
import type { MatrixChannelEntry } from './channels/matrix'
import type { TelegramChannelEntry } from './channels/telegram'
import type { FindingContext } from './finding-context'
import type { DispatchCounters } from './types'
import type { WebhookResult } from './webhook-post'

import {
  buildTelegramBody,
  buildTelegramDigestBody,
  buildWebhookDigestDispatchBody,
  buildWebhookDispatchBody,
  detectAdapter,
  summarizeDigest,
} from './../../adapters'
import { buildMatrixBody, buildMatrixDigestBody } from './../../adapters/matrix'
import {
  bufferDigestEntries,
  takeDueDigestEntries,
} from './../../alert-digest-buffer-store'
import { recordAlertEvent } from './../../alert-history-store'
import {
  buildCustomTargetBody,
  buildCustomTargetDigestBody,
  groupableCustomFormat,
} from './../../custom-webhook-targets'
import {
  buildMatrixTxnId,
  matrixTxnIdForPayload,
} from './../../matrix-dispatch'
import { telegramSendMessageUrl } from './../../telegram-dispatch'
import { SWEEP_ROUTING_OWNER_ID } from './../resolve-config'
import { buildAlertEventRecord, recordChannelEvent } from './alert-event-record'
import { sendCustomTarget } from './channels/custom-targets'
import { matrixSendError, sendMatrixChannel } from './channels/matrix'
import { postWebhook, postWebhookTarget } from './webhook-post'
import { debug } from '@chm/logger'
import { buildAlertBlocksWithAck } from '@/lib/slack/blocks'
import { isSlackAppConfigured } from '@/lib/slack/config'

/**
 * A lone reminder renders through the digest builder, which already prints a
 * reminder as one `still open, 5 h (a -> b)` line, instead of a full new
 * card. A lone Slack send with ack buttons keeps its card: the button is the
 * reason to keep the message actionable.
 */
function isCompactReminder(entry: {
  payload: AlertPayload
  slackAck?: unknown
}): boolean {
  return entry.payload.stillOpenMs !== undefined && !entry.slackAck
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
  /** Operator-configured URL; otherwise re-checked at send time. */
  trusted: boolean
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
 * A groupable custom target (hookshot / matrix, no templates; #3869). Grouped
 * by target id and sent in THIS pass only: these entries are never written to
 * the D1 time-window buffer because the target carries secret headers.
 */
interface CustomDigestEntry {
  target: EffectiveCustomWebhookTarget
  format: 'hookshot' | 'matrix'
  payload: AlertPayload
  /** Legacy one-line summary, passed through for a lone (bucket of 1) send. */
  text: string
  /** `null` when the finding was committed at buffer time (time-window mode). */
  pending: PendingDigestCommit | null
}

/**
 * A native Matrix room (route or env). In-pass only, like custom targets: the
 * access token never goes to the D1 time-window buffer. Keeps its finding so
 * every finding gets its own alert-history row, grouped or not.
 */
interface MatrixDigestEntry extends MatrixChannelEntry {
  finding: FindingContext
  payload: AlertPayload
  pending: PendingDigestCommit | null
}

/** What one finding contributes to the digest, once its inline channels ran. */
export interface SettleFindingParams {
  finding: FindingContext
  /** The finding's deferred dedup commit (from `evaluateAlert`). */
  commit: () => void
  /** Whether any inline (non-groupable) channel delivered. */
  anyDelivered: boolean
  /** Digest-capable webhook URLs this finding resolved to. */
  groupableWebhookTargets: WebhookTarget[]
  /** Telegram chats this finding resolved to (always groupable). */
  findingTelegramTargets: TelegramChannelEntry[]
  /** Groupable custom targets (hookshot / matrix, no templates) that admit this finding. */
  groupableCustomTargets?: readonly EffectiveCustomWebhookTarget[]
  /** Native Matrix rooms this finding resolved to (always groupable). */
  groupableMatrixTargets?: readonly MatrixChannelEntry[]
  /** How many non-groupable targets this finding dispatched to inline. */
  immediateTargetCount: number
  /** The finding's shared webhook payload (one timestamp per finding). */
  webhookPayload: AlertPayload
}

export interface DigestPipeline {
  settleFinding: (params: SettleFindingParams) => Promise<void>
  flushDigests: () => Promise<void>
}

/**
 * Build the digest layer for one sweep tick. Seeds the buckets with any
 * time-window-buffered entries whose window has closed (a destructive read —
 * done exactly once per tick, gated on digest mode being on).
 */
export async function createDigestPipeline(
  ctx: SweepContext,
  counters: DispatchCounters
): Promise<DigestPipeline> {
  const webhookDigestEntries: WebhookDigestEntry[] = []
  const telegramDigestEntries: TelegramDigestEntry[] = []
  const customDigestEntries: CustomDigestEntry[] = []
  const matrixDigestEntries: MatrixDigestEntry[] = []

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
        trusted: entry.trusted === true,
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
   * Digest accounting (#2663). Groupable (digest-capable) targets are the
   * Slack/generic webhook URLs + Telegram chats; every non-groupable channel
   * already dispatched inline (its count feeds `immediateTargetCount`). When
   * this finding has NO groupable target the original inline commit gate runs
   * unchanged; otherwise its commit + dispatch accounting is deferred to
   * {@link flushDigests} so it reflects the grouped delivery.
   */
  async function settleFinding({
    finding,
    commit,
    anyDelivered,
    groupableWebhookTargets,
    findingTelegramTargets,
    groupableCustomTargets = [],
    groupableMatrixTargets = [],
    immediateTargetCount,
    webhookPayload,
  }: SettleFindingParams): Promise<void> {
    const { hostId, ruleId, effective, isRecovery, decision, text } = finding

    const groupableTargetCount =
      groupableWebhookTargets.length +
      findingTelegramTargets.length +
      groupableCustomTargets.length +
      groupableMatrixTargets.length
    const customEntries = (
      pending: PendingDigestCommit | null
    ): CustomDigestEntry[] =>
      groupableCustomTargets.flatMap((target) => {
        const format = groupableCustomFormat(target)
        return format
          ? [{ target, format, payload: webhookPayload, text, pending }]
          : []
      })

    const matrixEntries = (
      pending: PendingDigestCommit | null
    ): MatrixDigestEntry[] =>
      groupableMatrixTargets.map((m) => ({
        ...m,
        finding,
        payload: webhookPayload,
        pending,
      }))

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
      ({ url, trusted }) => ({
        kind: 'webhook',
        url,
        trusted,
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
    // Custom-target entries are never buffered (they carry secret headers):
    // they still go out in this pass's flush, grouped with this pass's other
    // findings for the same target.
    const bufferable = webhookEntries.length + telegramEntries.length
    const shouldBuffer =
      ctx.digestWindowMs > 0 &&
      effective !== 'critical' &&
      !isRecovery &&
      bufferable > 0
    if (shouldBuffer) {
      const buffered = await bufferDigestEntries(
        SWEEP_ROUTING_OWNER_ID,
        [...webhookEntries, ...telegramEntries],
        Date.now() + ctx.digestWindowMs
      )
      if (buffered) {
        counters.digestBuffered += bufferable
        // The finding is committed now (it is queued), so its custom entries
        // carry no pending record: they deliver in this flush only.
        customDigestEntries.push(...customEntries(null))
        matrixDigestEntries.push(...matrixEntries(null))
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
        trusted: entry.trusted === true,
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
    customDigestEntries.push(...customEntries(pending))
    matrixDigestEntries.push(...matrixEntries(pending))
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
    // Time-window entries were already removed from the buffer (and their
    // findings' dedup committed) when they were parked, so a failed send here
    // would drop them for good. Collect them and park them again, due now, so
    // the next sweep retries the delivery.
    const failedBuffered: BufferedDigestEntry[] = []

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
      if (entries.length === 1 && !isCompactReminder(entries[0])) {
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
      // A URL group is trusted only when every entry in it is.
      const trusted = entries.every((e) => e.trusted)
      const result = await postWebhookTarget({ url, trusted }, body)
      if (result.ok) {
        for (const e of entries) {
          if (e.pending) e.pending.groupableDelivered = true
        }
      } else {
        for (const e of entries) {
          if (e.pending) continue
          failedBuffered.push({
            kind: 'webhook',
            url: e.url,
            trusted: e.trusted,
            text: e.text,
            payload: e.payload,
            ...(e.slackAck ? { slackAck: e.slackAck } : {}),
          })
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
        entries.length === 1 && !isCompactReminder(first)
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
      } else {
        for (const e of entries) {
          if (e.pending) continue
          failedBuffered.push({
            kind: 'telegram',
            botToken: e.botToken,
            chatId: e.chatId,
            payload: e.payload,
          })
        }
      }
      await recordDigestHistory(entries, 'telegram', result)
    }

    // Groupable custom targets (#3869) grouped by target id. A lone entry
    // sends the exact per-finding body; ≥2 send one digest. Never re-buffered
    // on failure (secret headers stay out of D1).
    const byTarget = new Map<string, CustomDigestEntry[]>()
    for (const entry of customDigestEntries) {
      const list = byTarget.get(entry.target.id)
      if (list) list.push(entry)
      else byTarget.set(entry.target.id, [entry])
    }
    for (const entries of byTarget.values()) {
      const first = entries[0]
      const body =
        entries.length === 1 && !isCompactReminder(first)
          ? buildCustomTargetBody(first.target, first.payload, first.text).body
          : buildCustomTargetDigestBody(
              first.format,
              entries.map((e) => e.payload)
            ).body
      const result = await sendCustomTarget(first.target, body)
      if (result.ok) {
        for (const e of entries) {
          if (e.pending) e.pending.groupableDelivered = true
        }
      }
      await recordDigestHistory(entries, `custom:${first.format}`, result)
    }

    // Native Matrix rooms grouped by homeserver + room + token. A lone entry
    // sends the single-alert body under its per-payload txn id; a digest's txn
    // id covers every member's, so a retry of the same send reuses it and any
    // other notification gets a new one. One history row per finding.
    const byRoom = new Map<string, MatrixDigestEntry[]>()
    for (const entry of matrixDigestEntries) {
      const { homeserverUrl, roomId, accessToken } = entry.target
      const key = `${homeserverUrl}\u0000${roomId}\u0000${accessToken}`
      const list = byRoom.get(key)
      if (list) list.push(entry)
      else byRoom.set(key, [entry])
    }
    for (const entries of byRoom.values()) {
      const first = entries[0]
      const roomId = first.target.roomId
      const lone = entries.length === 1 && !isCompactReminder(first)
      const body = lone
        ? buildMatrixBody(first.payload)
        : buildMatrixDigestBody(entries.map((e) => e.payload))
      const memberTxnIds = await Promise.all(
        entries.map((e) => matrixTxnIdForPayload(e.payload, roomId))
      )
      const txnId =
        entries.length === 1
          ? memberTxnIds[0]
          : await buildMatrixTxnId([roomId, 'digest', ...memberTxnIds])
      const result = await sendMatrixChannel(first, body, txnId)
      if (result.ok) {
        for (const e of entries) {
          if (e.pending) e.pending.groupableDelivered = true
        }
      }
      const error = matrixSendError(result)
      for (const e of entries) {
        await recordChannelEvent(e.finding, {
          delivered: result.ok,
          error,
          channel: 'matrix',
        })
      }
    }

    if (failedBuffered.length > 0) {
      const now = Date.now()
      const rebuffered = await bufferDigestEntries(
        SWEEP_ROUTING_OWNER_ID,
        failedBuffered,
        now
      )
      if (!rebuffered) {
        debug(
          `[health-sweep] could not re-buffer ${failedBuffered.length} undelivered digest entries; they are lost`
        )
      }
    }

    // Commit + count each distinct in-pass finding once. Buffered entries have
    // no `pending` (already committed when they were parked), so they only
    // deliver here — no double commit/count; a failed one was re-parked above.
    const pendings = new Set<PendingDigestCommit>()
    for (const e of webhookDigestEntries) if (e.pending) pendings.add(e.pending)
    for (const e of telegramDigestEntries)
      if (e.pending) pendings.add(e.pending)
    for (const e of customDigestEntries) if (e.pending) pendings.add(e.pending)
    for (const e of matrixDigestEntries) if (e.pending) pendings.add(e.pending)
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

  return { settleFinding, flushDigests }
}
