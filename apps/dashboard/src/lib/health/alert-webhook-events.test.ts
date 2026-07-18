/**
 * Tests for the `alert.fired`/`alert.resolved` producer (#2664).
 *
 * `emitInstanceEvent` is mocked at the module boundary so these tests exercise
 * exactly the two things `server-sweep.ts` relies on:
 *   1. `buildAlertWebhookEvent` maps a dedup decision onto the correct
 *      event type + payload (mirrors `buildAlertEventRecord`'s test style —
 *      pure mapping, no I/O).
 *   2. `dispatchDedupedAlertEvent` NEVER throws synchronously, even when the
 *      bus emission itself blows up — the whole point of this module is that
 *      a broken/slow webhook subscriber can never break the alert-history
 *      write or the legacy-channel fan-out that run right after it in
 *      `dispatchFinding`.
 *
 * HMAC signature + real delivery/fan-out over the bus is covered by
 * `lib/events/outbound-bus.test.ts`'s `emitInstanceEvent` suite; this file
 * only proves the sweep-side wiring feeding into it.
 */

import type { AlertDecision } from './alert-state-store'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

const emitted: unknown[] = []
let emitInstanceEventImpl: (evt: unknown) => Promise<void> = async (evt) => {
  emitted.push(evt)
}

mock.module('@/lib/events/outbound-bus', () => ({
  emitInstanceEvent: async (evt: unknown) => emitInstanceEventImpl(evt),
}))

const { buildAlertWebhookEvent, dispatchDedupedAlertEvent } = await import(
  './alert-webhook-events'
)

function decision(overrides: Partial<AlertDecision> = {}): AlertDecision {
  return {
    notify: true,
    kind: 'new',
    severity: 'critical',
    previousSeverity: 'ok',
    ...overrides,
  }
}

const baseParams = {
  hostId: 3,
  hostLabel: 'prod',
  ruleId: 'disk-usage',
  ruleTitle: 'Disk usage',
  value: 92,
  label: '92%',
  now: 1_700_000_000_000,
}

beforeEach(() => {
  emitted.length = 0
  emitInstanceEventImpl = async (evt) => {
    emitted.push(evt)
  }
})

describe('buildAlertWebhookEvent', () => {
  test('returns null for a suppressed/deduped (non-notify) decision', () => {
    const evt = buildAlertWebhookEvent({
      ...baseParams,
      decision: decision({ notify: false, kind: 'suppressed', severity: 'ok' }),
    })
    expect(evt).toBeNull()
  })

  test('a NEW alert builds alert.fired with the current severity and resolved:false', () => {
    const evt = buildAlertWebhookEvent({
      ...baseParams,
      decision: decision({
        kind: 'new',
        severity: 'critical',
        previousSeverity: 'ok',
      }),
    })
    expect(evt).not.toBeNull()
    expect(evt).toMatchObject({
      type: 'alert.fired',
      occurred_at: new Date(1_700_000_000_000).toISOString(),
      host_id: 3,
      data: {
        ruleId: 'disk-usage',
        title: 'Disk usage',
        severity: 'critical',
        hostId: 3,
        hostLabel: 'prod',
        value: 92,
        label: '92%',
        resolved: false,
        occurredAt: new Date(1_700_000_000_000).toISOString(),
      },
    })
    expect(evt?.id).toBeTruthy()
  })

  test('an ESCALATED alert builds alert.fired with the new (escalated) severity', () => {
    const evt = buildAlertWebhookEvent({
      ...baseParams,
      decision: decision({
        kind: 'escalated',
        severity: 'critical',
        previousSeverity: 'warning',
      }),
    })
    expect(evt?.type).toBe('alert.fired')
    expect((evt?.data as { severity: string }).severity).toBe('critical')
  })

  test('a REMINDER (persistent condition past cooldown) builds alert.fired again', () => {
    const evt = buildAlertWebhookEvent({
      ...baseParams,
      decision: decision({
        kind: 'reminder',
        severity: 'warning',
        previousSeverity: 'warning',
      }),
    })
    expect(evt?.type).toBe('alert.fired')
    expect((evt?.data as { severity: string }).severity).toBe('warning')
  })

  test('a RECOVERY builds alert.resolved with the severity it resolved FROM (previousSeverity), not "ok"', () => {
    const evt = buildAlertWebhookEvent({
      ...baseParams,
      decision: decision({
        kind: 'recovery',
        severity: 'ok',
        previousSeverity: 'critical',
      }),
    })
    expect(evt?.type).toBe('alert.resolved')
    expect(evt).toMatchObject({
      data: {
        severity: 'critical',
        resolved: true,
      },
    })
  })

  test('every event gets a fresh crypto.randomUUID() id — two calls never collide', () => {
    const a = buildAlertWebhookEvent({ ...baseParams, decision: decision() })
    const b = buildAlertWebhookEvent({ ...baseParams, decision: decision() })
    expect(a?.id).not.toBe(b?.id)
  })
})

describe('dispatchDedupedAlertEvent', () => {
  test('emits exactly once for a notify-worthy decision', () => {
    dispatchDedupedAlertEvent({ ...baseParams, decision: decision() })
    expect(emitted).toHaveLength(1)
  })

  test('emits nothing for a suppressed decision', () => {
    dispatchDedupedAlertEvent({
      ...baseParams,
      decision: decision({ notify: false, kind: 'suppressed', severity: 'ok' }),
    })
    expect(emitted).toHaveLength(0)
  })

  test('NEVER throws synchronously even when the underlying bus emission throws — the alert path must survive a broken/slow webhook subscriber', () => {
    emitInstanceEventImpl = async () => {
      throw new Error('subscriber endpoint unreachable')
    }
    expect(() =>
      dispatchDedupedAlertEvent({ ...baseParams, decision: decision() })
    ).not.toThrow()
  })

  test('never produces an unhandled rejection — the fire-and-forget call is never awaited by the caller', async () => {
    emitInstanceEventImpl = async () => {
      throw new Error('subscriber endpoint unreachable')
    }
    let unhandled: unknown
    const onUnhandled = (reason: unknown) => {
      unhandled = reason
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      dispatchDedupedAlertEvent({ ...baseParams, decision: decision() })
      // Let the fire-and-forget microtask/promise settle.
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toBeUndefined()
  })
})
