import type { PeerDBRule } from './alert-rules'

import {
  matchingPeerDBRules,
  mutingPeerDBRule,
  peerDBRuleFieldsSchema,
  thresholdsForMirror,
} from './alert-rules'
import { DEFAULT_PEERDB_ALERT_THRESHOLDS } from './alerting'
import { describe, expect, test } from 'bun:test'

function rule(partial: Partial<PeerDBRule> & { id: string }): PeerDBRule {
  return {
    check: 'lag',
    matchKind: 'glob',
    match: '*',
    warning: 10,
    critical: 20,
    severity: 'critical',
    enabled: true,
    muteUntil: null,
    ...partial,
  }
}

const FLEET = rule({
  id: 'fleet',
  match: 'qrep_sg_fleetreporting1_*',
  warning: 3600,
  critical: 14400,
})

describe('thresholdsForMirror', () => {
  test('no rules = the defaults, unchanged', () => {
    expect(thresholdsForMirror('pg_to_ch', [])).toEqual(
      DEFAULT_PEERDB_ALERT_THRESHOLDS
    )
  })

  test('a qrep_sg_fleetreporting1_* rule applies only to matching mirrors', () => {
    const hit = thresholdsForMirror('qrep_sg_fleetreporting1_orders', [FLEET])
    expect(hit.lagWarnSec).toBe(3600)
    expect(hit.lagErrorSec).toBe(14400)
    // Other checks keep their defaults.
    expect(hit.slotLagWarnMb).toBe(
      DEFAULT_PEERDB_ALERT_THRESHOLDS.slotLagWarnMb
    )

    for (const miss of [
      'qrep_sg_fleetreporting2_orders',
      'cdc_sg_fleetreporting1_orders',
      'qrep_sg_fleetreporting1',
    ]) {
      expect(thresholdsForMirror(miss, [FLEET])).toEqual(
        DEFAULT_PEERDB_ALERT_THRESHOLDS
      )
    }
  })

  test('precedence: exact > longest prefix > most literal glob, ties by id', () => {
    const name = 'qrep_sg_fleetreporting1_orders'
    const rules = [
      rule({ id: 'g-any', match: '*', warning: 1, critical: 2 }),
      FLEET,
      rule({
        id: 'p-short',
        matchKind: 'prefix',
        match: 'qrep_',
        warning: 5,
        critical: 6,
      }),
      rule({
        id: 'p-long',
        matchKind: 'prefix',
        match: 'qrep_sg_',
        warning: 7,
        critical: 8,
      }),
    ]
    expect(thresholdsForMirror(name, rules).lagWarnSec).toBe(7)

    const withExact = [
      ...rules,
      rule({
        id: 'x',
        matchKind: 'exact',
        match: name,
        warning: 9,
        critical: 9,
      }),
    ]
    expect(thresholdsForMirror(name, withExact).lagWarnSec).toBe(9)

    // Glob vs glob: more literal characters wins regardless of list order.
    expect(
      thresholdsForMirror(name, [
        rule({ id: 'g-any', match: '*', warning: 1, critical: 2 }),
        FLEET,
      ]).lagWarnSec
    ).toBe(3600)

    // Equal specificity: lower id wins, independent of order.
    const a = rule({ id: 'a', match: 'qrep_*', warning: 11, critical: 12 })
    const b = rule({ id: 'b', match: 'qrep_*', warning: 13, critical: 14 })
    expect(thresholdsForMirror(name, [b, a]).lagWarnSec).toBe(11)
    expect(thresholdsForMirror(name, [a, b]).lagWarnSec).toBe(11)
  })

  test('rules for different checks combine; disabled rules are ignored', () => {
    const t = thresholdsForMirror('m1', [
      rule({ id: 'lag', check: 'lag', warning: 1, critical: 2 }),
      rule({ id: 'slot', check: 'slot-lag', warning: 3, critical: 4 }),
      rule({
        id: 'off',
        check: 'errors',
        warning: 50,
        critical: 60,
        enabled: false,
      }),
    ])
    expect([t.lagWarnSec, t.slotLagWarnMb, t.errorWarnCount]).toEqual([
      1,
      3,
      DEFAULT_PEERDB_ALERT_THRESHOLDS.errorWarnCount,
    ])
  })

  test('severity warning disables the critical threshold for that check', () => {
    const t = thresholdsForMirror('m1', [
      rule({
        id: 'w',
        check: 'stale-sync',
        warning: 60,
        critical: 120,
        severity: 'warning',
      }),
    ])
    expect(t.staleSyncWarnSec).toBe(60)
    expect(t.staleSyncErrorSec).toBe(Number.POSITIVE_INFINITY)
  })

  test('matching is case-insensitive', () => {
    expect(
      matchingPeerDBRules('QREP_SG_FLEETREPORTING1_X', [FLEET])
    ).toHaveLength(1)
  })
})

describe('mutingPeerDBRule', () => {
  const now = 1_000_000
  test('a future muteUntil mutes only matching mirrors', () => {
    const muted = { ...FLEET, muteUntil: now + 1 }
    expect(
      mutingPeerDBRule('qrep_sg_fleetreporting1_a', [muted], now)?.id
    ).toBe('fleet')
    expect(mutingPeerDBRule('other', [muted], now)).toBeNull()
  })
  test('an expired or disabled mute does nothing', () => {
    expect(
      mutingPeerDBRule(
        'qrep_sg_fleetreporting1_a',
        [{ ...FLEET, muteUntil: now }],
        now
      )
    ).toBeNull()
    expect(
      mutingPeerDBRule(
        'qrep_sg_fleetreporting1_a',
        [{ ...FLEET, muteUntil: now + 1, enabled: false }],
        now
      )
    ).toBeNull()
  })
})

describe('peerDBRuleFieldsSchema', () => {
  test('rejects warning above critical, negative values and empty match', () => {
    const base = { check: 'lag', match: 'x', warning: 1, critical: 2 }
    expect(peerDBRuleFieldsSchema.safeParse(base).success).toBe(true)
    expect(
      peerDBRuleFieldsSchema.safeParse({ ...base, warning: 3 }).success
    ).toBe(false)
    expect(
      peerDBRuleFieldsSchema.safeParse({ ...base, warning: -1 }).success
    ).toBe(false)
    expect(
      peerDBRuleFieldsSchema.safeParse({ ...base, match: '  ' }).success
    ).toBe(false)
    expect(
      peerDBRuleFieldsSchema.safeParse({ ...base, check: 'cpu' }).success
    ).toBe(false)
  })
})
