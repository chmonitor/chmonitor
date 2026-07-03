/**
 * Tests for the pure Slack Block Kit builders (plans/37-slack-app-native-oauth).
 *
 * Asserts the slash-command and alert-ACK payloads are well-formed JSON blocks
 * with the expected `action_id`, and that the ACK-value codec round-trips and
 * rejects malformed input — the interactions route depends on both.
 */

import type { AlertPayload } from '@/lib/health/adapters/types'
import type { IncidentSnapshot } from '@/lib/health/incident-snapshot'

import {
  ACK_ACTION_ID,
  type AckKey,
  buildAckedMessageBlocks,
  buildAlertBlocksWithAck,
  buildAlertListBlocks,
  buildHomeTabView,
  buildQueryResultBlocks,
  buildStatusBlocks,
  decodeAckValue,
  encodeAckValue,
} from './blocks'
import { describe, expect, test } from 'bun:test'

/** Every block must at minimum have a string `type`, and be JSON-serializable. */
function assertWellFormed(blocks: unknown[]): void {
  expect(Array.isArray(blocks)).toBe(true)
  expect(blocks.length).toBeGreaterThan(0)
  for (const block of blocks) {
    expect(typeof block).toBe('object')
    expect(typeof (block as { type: unknown }).type).toBe('string')
  }
  // Round-trips through JSON without throwing (no undefined/circular refs).
  expect(() => JSON.parse(JSON.stringify(blocks))).not.toThrow()
}

const SNAPSHOT: IncidentSnapshot = {
  hostId: 0,
  capturedAt: '2026-07-04T00:00:00.000Z',
  topQueries: [],
  merges: { active: 2, stuck: 1, maxElapsed: 700 },
  memoryUsagePct: 42.5,
  diskUsagePct: 71.25,
  replicationLagSeconds: 3,
}

const ALERT: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-1',
  hostId: 0,
  metric: 'failed-mutations',
  value: 3,
  title: 'Failed mutations',
  label: '3 failed mutations',
  timestamp: '2026-07-04T00:00:00.000Z',
}

describe('encode/decodeAckValue', () => {
  test('round-trips a key', () => {
    const key: AckKey = {
      hostId: 2,
      ruleId: 'failed-mutations',
      severity: 'critical',
    }
    const encoded = encodeAckValue(key)
    expect(encoded.length).toBeLessThanOrEqual(2000)
    expect(decodeAckValue(encoded)).toEqual(key)
  })

  test('rejects malformed / missing values', () => {
    expect(decodeAckValue(null)).toBeNull()
    expect(decodeAckValue('')).toBeNull()
    expect(decodeAckValue('not json')).toBeNull()
    expect(decodeAckValue('{}')).toBeNull()
    expect(
      decodeAckValue(JSON.stringify({ h: -1, r: 'x', s: 'critical' }))
    ).toBeNull()
    expect(
      decodeAckValue(JSON.stringify({ h: 0, r: '', s: 'critical' }))
    ).toBeNull()
    expect(
      decodeAckValue(JSON.stringify({ h: 0, r: 'x', s: 'bogus' }))
    ).toBeNull()
  })
})

describe('buildStatusBlocks', () => {
  test('renders a well-formed status summary', () => {
    const blocks = buildStatusBlocks('prod-1', SNAPSHOT)
    assertWellFormed(blocks)
    const json = JSON.stringify(blocks)
    expect(json).toContain('prod-1')
    expect(json).toContain('42.5%')
    expect(json).toContain('stuck')
  })
})

describe('buildQueryResultBlocks', () => {
  test('renders a table for rows', () => {
    const blocks = buildQueryResultBlocks(
      'SELECT name, total FROM t',
      [
        { name: 'a', total: 1 },
        { name: 'b', total: 2 },
      ],
      { rowCap: 20, durationMs: 12 }
    )
    assertWellFormed(blocks)
    const json = JSON.stringify(blocks)
    expect(json).toContain('name')
    expect(json).toContain('2 row(s)')
  })

  test('handles an empty result set', () => {
    const blocks = buildQueryResultBlocks('SELECT 1', [], { rowCap: 20 })
    assertWellFormed(blocks)
    expect(JSON.stringify(blocks)).toContain('No rows')
  })
})

describe('buildAlertListBlocks', () => {
  test('renders recent alerts', () => {
    const blocks = buildAlertListBlocks([
      {
        eventTime: '2026-07-04T00:00:00.000Z',
        hostId: 0,
        hostLabel: 'prod-1',
        rule: 'failed-mutations',
        severity: 'critical',
        decisionKind: 'new',
        delivered: true,
        value: 3,
      },
    ])
    assertWellFormed(blocks)
    expect(JSON.stringify(blocks)).toContain('failed-mutations')
  })

  test('shows an empty-state when there is no history', () => {
    const blocks = buildAlertListBlocks([])
    assertWellFormed(blocks)
    expect(JSON.stringify(blocks)).toContain('No recent alerts')
  })
})

describe('buildAlertBlocksWithAck', () => {
  test('critical alert carries an Acknowledge button with the ACK action_id', () => {
    const key: AckKey = {
      hostId: 0,
      ruleId: 'failed-mutations',
      severity: 'critical',
    }
    const blocks = buildAlertBlocksWithAck(ALERT, key)
    assertWellFormed(blocks)

    const actions = blocks.find((b) => b.type === 'actions')
    expect(actions).toBeDefined()
    const button = actions?.elements?.[0] as
      | { action_id?: string; value?: string; text?: { text?: string } }
      | undefined
    expect(button?.action_id).toBe(ACK_ACTION_ID)
    expect(button?.text?.text).toBe('Acknowledge')
    // The button value decodes back to the same alert identity.
    expect(decodeAckValue(button?.value)).toEqual(key)
  })

  test('recovery alert has no Acknowledge button', () => {
    const recovery: AlertPayload = { ...ALERT, severity: 'recovery' }
    const key: AckKey = {
      hostId: 0,
      ruleId: 'failed-mutations',
      severity: 'recovery',
    }
    const blocks = buildAlertBlocksWithAck(recovery, key)
    assertWellFormed(blocks)
    expect(blocks.find((b) => b.type === 'actions')).toBeUndefined()
  })
})

describe('buildAckedMessageBlocks', () => {
  test('removes the actions block and appends an acked-by context', () => {
    const key: AckKey = {
      hostId: 0,
      ruleId: 'failed-mutations',
      severity: 'critical',
    }
    const original = buildAlertBlocksWithAck(ALERT, key)
    const updated = buildAckedMessageBlocks(
      original,
      'U123',
      '2026-07-04T00:05:00.000Z'
    )
    assertWellFormed(updated)
    expect(updated.find((b) => b.type === 'actions')).toBeUndefined()
    expect(JSON.stringify(updated)).toContain('<@U123>')
  })
})

describe('buildHomeTabView', () => {
  test('publishes a home view with host summaries and a dashboard link', () => {
    const view = buildHomeTabView(
      [
        {
          hostId: 0,
          label: 'prod-1',
          memoryUsagePct: 40,
          diskUsagePct: 55,
          firing: 2,
        },
      ],
      { dashboardUrl: 'https://dash.chmonitor.dev' }
    )
    expect(view.type).toBe('home')
    assertWellFormed(view.blocks)
    const json = JSON.stringify(view.blocks)
    expect(json).toContain('prod-1')
    expect(json).toContain('2 firing')
    expect(json).toContain('https://dash.chmonitor.dev')
  })

  test('handles no hosts', () => {
    const view = buildHomeTabView([])
    assertWellFormed(view.blocks)
    expect(JSON.stringify(view.blocks)).toContain('No ClickHouse hosts')
  })
})
