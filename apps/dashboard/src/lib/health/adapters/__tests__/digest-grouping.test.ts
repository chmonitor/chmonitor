/**
 * Digest rows grouped by rule (#4246).
 *
 * A rule that fires once per source used to put one row per source in the
 * digest, so one cause filled the whole message and truncation cut the cause
 * off. Findings now group by (rule, severity): one row with the rule title, a
 * count and a few example names. The header still counts findings.
 */

import type { AlertPayload } from '../types'

import {
  buildGenericJsonDigestBody,
  buildSlackDigestBody,
  buildTelegramDigestText,
  digestFindingLine,
  summarizeDigest,
} from '../index'
import { describe, expect, test } from 'bun:test'

const TITLE = 'Source stopped sending rows'

function finding(over: Partial<AlertPayload> = {}): AlertPayload {
  return {
    severity: 'warning',
    hostLabel: 'node-1',
    hostId: 1,
    metric: 'source-silent',
    value: 1,
    title: TITLE,
    label: 'db.events:source-1',
    timestamp: '2026-10-30T02:20:00.000Z',
    ...over,
  }
}

/** `n` findings of one rule on one host, one per source. */
const sources = (n: number, over: Partial<AlertPayload> = {}) =>
  Array.from({ length: n }, (_, i) =>
    finding({ label: `db.events:source-${i + 1}`, ...over })
  )

/** The Slack digest table's rows as plain cell text, header row first. */
const slackTable = (payloads: AlertPayload[]) =>
  (buildSlackDigestBody(payloads).blocks?.[1].rows ?? []).map((row) =>
    row.map((cell) => cell.text)
  )

describe('34 findings of one rule', () => {
  const many = sources(34)

  test('render as one Slack row with a count and three example names', () => {
    expect(slackTable(many)).toEqual([
      ['Status', 'Problem', 'Where', 'Since'],
      [
        '🟠 WARNING',
        `${TITLE} (34)`,
        'db.events:source-1, db.events:source-2, db.events:source-3, +31',
        'new',
      ],
    ])
  })

  test('render as one summary line for text channels', () => {
    const s = summarizeDigest(many)
    expect(s.findingLines).toEqual([
      `[WARNING] ${TITLE} · 34 (db.events:source-1, db.events:source-2, db.events:source-3, +31)`,
    ])
    expect(s.overflow).toBe(0)
    expect(buildTelegramDigestText(many).match(/•/g)).toHaveLength(1)
  })

  test('the header counts findings, not groups', () => {
    const body = buildSlackDigestBody(many)
    expect(body.blocks?.[0].text?.text).toContain('34 warning on 1 host')
    expect(body.text).toContain('(34 alerts)')
    expect(summarizeDigest(many).total).toBe(34)
  })

  test('generic JSON keeps every finding but its text has one row', () => {
    const body = buildGenericJsonDigestBody(many)
    expect(body.alerts).toHaveLength(34)
    expect(body.count).toBe(34)
    expect(body.text.split('\n')).toHaveLength(2)
  })
})

test('a group of one renders exactly as an ungrouped finding', () => {
  const one = finding({ label: 'db.events:source-7 silent over 48 h' })
  expect(summarizeDigest([one]).findingLines).toEqual([digestFindingLine(one)])
  expect(slackTable([one])[1]).toEqual([
    '🟠 WARNING',
    TITLE,
    // A lone finding keeps its host: it has no other rows to repeat.
    'db.events:source-7 silent over 48 h · node-1',
    'new',
  ])
})

test('mixed rules get one row each, in first-seen order', () => {
  const lines = summarizeDigest([
    ...sources(3),
    finding({ metric: 'disk-usage', title: 'Disk usage', label: '91% used' }),
    ...sources(2, { severity: 'critical' }),
  ]).findingLines
  expect(lines).toEqual([
    `[WARNING] ${TITLE} · 3 (db.events:source-1, db.events:source-2, db.events:source-3)`,
    '[WARNING] Disk usage — 91% used',
    `[CRITICAL] ${TITLE} · 2 (db.events:source-1, db.events:source-2)`,
  ])
})

test('recoveries group apart from firing findings of the same rule', () => {
  const payloads = [...sources(4), ...sources(2, { severity: 'recovery' })]
  expect(slackTable(payloads).slice(1)).toEqual([
    [
      '🟠 WARNING',
      `${TITLE} (4)`,
      'db.events:source-1, db.events:source-2, db.events:source-3, +1',
      'new',
    ],
    [
      '🟢 RESOLVED',
      `${TITLE} (2)`,
      'db.events:source-1, db.events:source-2',
      'new',
    ],
  ])
  expect(summarizeDigest(payloads).summaryLine).toBe(
    '4 warning, 2 recovery on 1 host (node-1)'
  )
})

test('a rule firing on several hosts names the hosts', () => {
  const hosts = Array.from({ length: 5 }, (_, i) =>
    finding({ hostId: i, hostLabel: `node-${i}`, label: '91% used' })
  )
  expect(summarizeDigest(hosts).findingLines[0]).toBe(
    `[WARNING] ${TITLE} · 5 (node-0, node-1, node-2, +2)`
  )
})

test('Since is the oldest finding of the group; Where adds hosts when the digest spans hosts', () => {
  const rows = slackTable([
    finding({ label: 'db.events:source-1', stillOpenMs: 30 * 60_000 }),
    finding({
      hostId: 2,
      hostLabel: 'node-2',
      label: 'db.events:source-2',
      stillOpenMs: 3 * 3_600_000,
    }),
  ])
  expect(rows[1]).toEqual([
    '🟠 WARNING',
    `${TITLE} (2)`,
    'db.events:source-1, db.events:source-2 · node-1, node-2',
    '3 h',
  ])
})
