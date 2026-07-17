/**
 * `alert.fired` / `alert.resolved` producer for the outbound webhook-subscriptions
 * bus (#2664).
 *
 * Pure payload-building is split from emission so the tricky part — mapping a
 * dedup `AlertDecision` onto the bus's `resolved`/severity shape — is
 * unit-testable without mocking D1 or the sweep (same split as
 * `buildAlertEventRecord` in `server-sweep.ts`).
 *
 * `dispatchDedupedAlertEvent` is the side-effecting half `server-sweep.ts`
 * actually calls: fire-and-forget (`void emitInstanceEvent(...)`), never
 * throws, so a slow/failing subscriber can NEVER block or fail the alert
 * sweep itself — same non-blocking contract `outbound-bus.ts`'s module
 * docblock documents for `emitEvent`. It is called once per finding, at the
 * SAME point in `dispatchFinding` all the other channels (Opsgenie/email/
 * Telegram/ntfy) are — i.e. AFTER dedup (`evaluateAlert`) has already decided
 * this is a genuinely new/escalated/reminder/recovery notification, and
 * BEFORE any legacy-channel fan-out — so it fires exactly once per dedup
 * decision, regardless of how many (if any) legacy channels are configured.
 */

import type { AlertDecision } from './alert-state-store'
import type { AlertEventData, EventPayload } from '@/lib/events/event-types'

import { debug } from '@chm/logger'
import { emitInstanceEvent } from '@/lib/events/outbound-bus'

export interface BuildAlertWebhookEventParams {
  hostId: number
  hostLabel: string
  ruleId: string
  ruleTitle: string
  decision: AlertDecision
  value: number | null
  label: string
  /** Injectable clock for tests. Defaults to `Date.now()`. */
  now?: number
}

/**
 * Maps a dedup decision onto the bus payload, or `null` when this decision
 * isn't something a bus subscriber should hear about (`notify: false`, i.e.
 * suppressed/deduped — same gate every other channel in `dispatchFinding`
 * already honors).
 *
 * Severity for `alert.resolved` is `decision.previousSeverity` — the severity
 * the condition resolved FROM — never `decision.severity` (which is `'ok'`
 * for a recovery and not a valid bus severity). A recovery decision always
 * carries a non-'ok' `previousSeverity` (see `decideNotification` in
 * `alert-state-store.ts`: recovery only fires when `previousSeverity !== 'ok'`),
 * so this is safe without an extra runtime check.
 */
export function buildAlertWebhookEvent(
  params: BuildAlertWebhookEventParams
): EventPayload<AlertEventData> | null {
  const { decision } = params
  if (!decision.notify) return null

  const resolved = decision.kind === 'recovery'
  const severity: 'warning' | 'critical' = resolved
    ? (decision.previousSeverity as 'warning' | 'critical')
    : (decision.severity as 'warning' | 'critical')

  const occurredAt = new Date(params.now ?? Date.now()).toISOString()

  const data: AlertEventData = {
    ruleId: params.ruleId,
    title: params.ruleTitle,
    severity,
    hostId: params.hostId,
    hostLabel: params.hostLabel,
    value: params.value,
    label: params.label,
    resolved,
    occurredAt,
  }

  return {
    id: crypto.randomUUID(),
    type: resolved ? 'alert.resolved' : 'alert.fired',
    occurred_at: occurredAt,
    host_id: params.hostId,
    data,
  }
}

/**
 * Builds the event (if any) and fires it at the instance-scoped bus,
 * fire-and-forget. `emitInstanceEvent` itself never throws or rejects (see
 * `outbound-bus.ts`'s module docblock), but this function is defense in
 * depth on BOTH axes anyway:
 *
 *   - the try/catch guards against a SYNCHRONOUS throw (a bug in
 *     `buildAlertWebhookEvent`'s pure mapping, or any future change to it) —
 *     matching the same belt-and-suspenders pattern `server-sweep.ts` already
 *     applies around every `recordAlertEvent` call.
 *   - the `.catch()` guards against an ASYNCHRONOUS rejection (nothing a
 *     synchronous try/catch can see) so a slow/unreachable subscriber
 *     endpoint can never surface as an unhandled promise rejection, on top of
 *     never being awaited (so it can never block the sweep either).
 *
 * The whole point of this function existing is that NOTHING it does — sync
 * or async — can ever propagate into `dispatchFinding` and take down the
 * rest of the alert path (alert-history writes, the legacy webhook/email/
 * Telegram/etc. fan-out that runs right after it).
 */
export function dispatchDedupedAlertEvent(
  params: BuildAlertWebhookEventParams
): void {
  try {
    const event = buildAlertWebhookEvent(params)
    if (!event) return
    void emitInstanceEvent(event).catch((err) => {
      debug(
        `[health-sweep] webhook-subscriptions bus emit failed for host ${params.hostId} rule ${params.ruleId}`,
        err instanceof Error ? err.message : String(err)
      )
    })
  } catch (err) {
    debug(
      `[health-sweep] webhook-subscriptions bus emit failed for host ${params.hostId} rule ${params.ruleId}`,
      err instanceof Error ? err.message : String(err)
    )
  }
}
