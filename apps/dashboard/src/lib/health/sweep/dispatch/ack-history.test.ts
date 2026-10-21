/**
 * An ACK-silenced alert must leave an alert-history record.
 *
 * Operators use the history log to see why a page did not fire. The
 * maintenance and quiet-hours gates already record a non-delivered event when
 * they suppress; the ACK gate must do the same with `decisionKind: 'acked'`.
 */

import type { AlertAck } from '../../alert-ack-store'
import type { AlertEventRecord } from '../../alert-history-store'
import type { SweepContext } from '../resolve-config'

import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

const recorded: AlertEventRecord[] = []

const realAlertHistoryStore = {
  ...(await import('../../alert-history-store')),
}
mock.module('../../alert-history-store', () => ({
  ...realAlertHistoryStore,
  recordAlertEvent: async (record: AlertEventRecord) => {
    recorded.push(record)
  },
}))

// Restore the real module so this mock never leaks into other test files.
afterAll(() => {
  mock.module('../../alert-history-store', () => ({ ...realAlertHistoryStore }))
})

const { createDispatcher } = await import('./index')

const HOST_ID = 7
const RULE_ID = 'ack-history-rule'

function makeCtx(acks: AlertAck[]): SweepContext {
  return {
    settings: { minSeverity: 'warning' },
    routes: [],
    pagerDutyFallbackKey: '',
    channels: {
      webhookUrl: '',
      opsgenie: null,
      email: null,
      telegram: null,
      ntfy: null,
      twilio: null,
      pushover: null,
      healthchecksUrl: '',
      channelSettings: {},
    },
    channelSettings: {},
    alertingEnabled: true,
    cooldown: { defaultMs: 60_000, byRule: {} },
    repeatMinDelta: { default: null, byRule: {} },
    mutedRules: [],
    rules: [],
    thresholdOverrides: {},
    hysteresis: {
      defaults: { minConsecutiveBreaches: 1, minConsecutiveClears: 1 },
      byRule: {},
    },
    orderedCompoundRules: [],
    configs: [],
    windows: [],
    quietHours: [],
    digestWindowMs: 0,
    acks,
  } as unknown as SweepContext
}

function activeAck(): AlertAck {
  return {
    ownerId: 'test-owner',
    hostId: HOST_ID,
    ruleId: RULE_ID,
    ackedBy: 'operator',
    ackedAt: Date.now(),
    expiresAt: Date.now() + 60 * 60_000,
    note: '',
  }
}

describe('dispatch — ACK suppression records alert history', () => {
  beforeEach(() => {
    recorded.length = 0
  })

  test('an acked finding writes one decisionKind=acked, undelivered history record', async () => {
    const dispatcher = await createDispatcher(makeCtx([activeAck()]))

    await dispatcher.dispatchFinding({
      hostId: HOST_ID,
      hostName: 'host-a',
      ruleId: RULE_ID,
      ruleType: 'custom',
      ruleTitle: 'Ack history rule',
      severity: 'critical',
      value: 42,
      label: 'value',
    })

    // The ACK suppresses dispatch, so the only observable effect is the record.
    expect(dispatcher.counters.ackedSuppressed).toBe(1)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      hostId: HOST_ID,
      hostLabel: 'host-a',
      rule: RULE_ID,
      decisionKind: 'acked',
      delivered: false,
      value: 42,
      channel: 'acked',
    })
  })

  test('a finding with no matching ACK records nothing from the ACK gate', async () => {
    const dispatcher = await createDispatcher(makeCtx([]))

    await dispatcher.dispatchFinding({
      hostId: HOST_ID,
      hostName: 'host-a',
      ruleId: RULE_ID,
      ruleType: 'custom',
      ruleTitle: 'Ack history rule',
      severity: 'critical',
      value: 42,
      label: 'value',
    })

    expect(dispatcher.counters.ackedSuppressed).toBe(0)
    expect(recorded.every((r) => r.decisionKind !== 'acked')).toBe(true)
  })
})
