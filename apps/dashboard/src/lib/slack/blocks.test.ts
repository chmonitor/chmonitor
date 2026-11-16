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
import { expectBlockKit } from '@/lib/health/adapters/__tests__/slack-block-kit'

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
  test('renders a bold lead, one line of facts and the capture time', () => {
    const blocks = buildStatusBlocks('prod-1', SNAPSHOT)
    expect(blocks).toEqual([
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '📊 *Cluster status*  prod-1\nMemory 42.5% · Disk 71.3% · Running queries 0 · Active merges 2 (1 stuck) · Replication lag 3s',
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: 'Captured 2026-07-04 00:00 UTC' }],
      },
    ])
    expectBlockKit(blocks)
  })

  test('a failed probe reads n/a and the host label is escaped', () => {
    const blocks = buildStatusBlocks('<!channel>', {
      ...SNAPSHOT,
      topQueries: null,
      merges: null,
      memoryUsagePct: null,
      diskUsagePct: null,
      replicationLagSeconds: null,
    })
    expect(blocks[0].text?.text).toBe(
      '📊 *Cluster status*  &lt;!channel&gt;\nMemory n/a · Disk n/a · Running queries n/a · Active merges n/a · Replication lag n/a'
    )
  })
})

describe('buildQueryResultBlocks', () => {
  test('renders one line per row, first column bold, the rest as facts', () => {
    const blocks = buildQueryResultBlocks(
      'SELECT name, total FROM t',
      [
        { name: 'a', total: 1 },
        { name: 'b', total: 2 },
      ],
      { rowCap: 20, durationMs: 12 }
    )
    expect(blocks).toEqual([
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '🔎 *Query result*  2 rows · 12 ms\n*a* · total 1\n*b* · total 2',
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '`SELECT name, total FROM t`' }],
      },
    ])
  })

  test('handles an empty result set', () => {
    const blocks = buildQueryResultBlocks('SELECT 1', [], { rowCap: 20 })
    expect(blocks[0].text?.text).toBe(
      '🔎 *Query result*  0 rows\n_No rows returned._'
    )
  })

  test('cells are escaped now that no code block protects them', () => {
    const blocks = buildQueryResultBlocks(
      'SELECT 1',
      [{ name: '<!channel>', note: 'a & b', missing: null }],
      { rowCap: 20, truncated: true }
    )
    expect(blocks[0].text?.text).toBe(
      '🔎 *Query result*  1 row · result capped\n*&lt;!channel&gt;* · note a &amp; b · missing ∅'
    )
  })

  test('a multi-line cell stays on its row line', () => {
    const blocks = buildQueryResultBlocks(
      'SELECT query FROM system.query_log',
      [{ query: 'SELECT 1\nFROM t\n\tWHERE x' }],
      { rowCap: 20 }
    )
    expect(blocks[0].text?.text).toBe(
      '🔎 *Query result*  1 row\n*SELECT 1 FROM t WHERE x*'
    )
  })

  test('a wide row shows eight columns and counts the rest', () => {
    const row = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`c${i}`, i])
    )
    const blocks = buildQueryResultBlocks('SELECT *', [row], { rowCap: 20 })
    expect(blocks[0].text?.text?.split('\n')[1]).toBe(
      '*0* · c1 1 · c2 2 · c3 3 · c4 4 · c5 5 · c6 6 · c7 7 · +2 columns'
    )
  })

  test('stays inside Block Kit limits for wide, hostile rows', () => {
    const rows = Array.from({ length: 20 }, () =>
      Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [
          `${'&'.repeat(80)}${i}`,
          '&'.repeat(200),
        ])
      )
    )
    expectBlockKit(
      buildQueryResultBlocks(`SELECT ${'x'.repeat(5000)}`, rows, {
        rowCap: 20,
        durationMs: 5,
      })
    )
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
    expectBlockKit(blocks)

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

  test('reads as one compact line, the detail, then a small footer', () => {
    const blocks = buildAlertBlocksWithAck(ALERT, {
      hostId: 0,
      ruleId: 'failed-mutations',
      severity: 'critical',
    })
    expect(blocks.map((b) => b.type)).toEqual(['section', 'actions', 'context'])
    expect(blocks[0].text?.text).toBe(
      '🔴 *CRITICAL*  Failed mutations · prod-1 · 3\n3 failed mutations'
    )
    expect(blocks[2].elements?.[0]).toEqual({
      type: 'mrkdwn',
      text: 'failed-mutations · 2026-07-04 00:00 UTC',
    })
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
