/**
 * The Slack app's thread reply for one finding: compact lines and a small
 * footer, never a fields grid. A reader scans one line for what is wrong and
 * where, then the footer for the rule, runbooks and when.
 */

import type { AlertPayload } from '../types'

import { buildSlackBotDetails } from '../slack'
import { expectBlockKit } from './slack-block-kit'
import { describe, expect, test } from 'bun:test'

const ACK = {
  type: 'actions',
  block_id: 'chmonitor_ack',
  elements: [
    {
      type: 'button',
      text: { type: 'plain_text', text: 'Acknowledge', emoji: true },
      action_id: 'chmonitor_ack_alert',
      value: '{"h":2,"r":"failed-mutations","s":"critical"}',
    },
  ],
}

const FULL: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-1',
  hostId: 2,
  metric: 'failed-mutations',
  value: 7,
  warnThreshold: 1,
  critThreshold: 5,
  title: 'Failed mutations',
  label: '3 failed mutations: db.t1, db.t2, db.t3',
  runbookUrls: ['https://docs.example.com/runbook/mutations'],
  actions: [
    { id: 'fm-detail', label: 'Get failed mutations', kind: 'diagnostic' },
  ],
  timestamp: '2026-07-04T00:00:00.000Z',
  instanceName: 'prod-eu',
  dashboardUrl: 'https://chm.example.com/health?host=2',
  metadata: { team: 'db' },
  stillOpenMs: 3 * 3_600_000,
  previousValue: 5,
}

/** The shape the sweep builds by hand for an ack message: no extras. */
const BARE: AlertPayload = {
  severity: 'warning',
  hostLabel: 'prod-1',
  hostId: 2,
  metric: 'failed-mutations',
  value: 3,
  title: 'Failed mutations',
  label: '3 failed mutations',
  timestamp: '2026-07-04T00:00:00.000Z',
}

const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1

describe('buildSlackBotDetails', () => {
  test('one compact section, the ack, then a one-line footer', () => {
    expect(buildSlackBotDetails(FULL, [ACK])).toEqual({
      text: 'Details: Failed mutations on prod-1',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              '🔴 *CRITICAL*  [prod-eu] Failed mutations · prod-1 · 7 (warn 1, crit 5) · still open, 3 h (5 -&gt; 7) · <https://chm.example.com/health?host=2|Open>',
              '3 failed mutations: db.t1, db.t2, db.t3',
              'Diagnostics in the dashboard: Get failed mutations',
            ].join('\n'),
          },
        },
        ACK,
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '<https://docs.example.com/runbook/mutations|Runbook> · failed-mutations · team=db · 2026-07-04 00:00 UTC',
            },
          ],
        },
      ],
    })
  })

  test('each fact appears once', () => {
    const flat = JSON.stringify(buildSlackBotDetails(FULL).blocks)
    expect(count(flat, 'prod-1')).toBe(1)
    expect(count(flat, 'prod-eu')).toBe(1)
    expect(count(flat, 'warn 1')).toBe(1)
    expect(count(flat, 'failed-mutations')).toBe(1)
    expect(count(flat, 'team=db')).toBe(1)
  })

  test('a payload with no extras renders without empty parts', () => {
    expect(buildSlackBotDetails(BARE).blocks).toEqual([
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '🟠 *WARNING*  Failed mutations · prod-1 · 3\n3 failed mutations',
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'failed-mutations · 2026-07-04 00:00 UTC',
          },
        ],
      },
    ])
  })

  test('the notification fallback cannot ping the channel', () => {
    const text = buildSlackBotDetails({
      ...BARE,
      title: '<!channel> mutations',
    }).text
    expect(text).toBe('Details: &lt;!channel&gt; mutations on prod-1')
  })

  test('stays inside Block Kit limits for oversized input', () => {
    const huge: AlertPayload = {
      ...FULL,
      title: 'T'.repeat(5000),
      label: '&'.repeat(5000),
      runbookUrls: Array.from(
        { length: 20 },
        (_, i) => `https://docs.example.com/${'r'.repeat(200)}/${i}`
      ),
      actions: Array.from({ length: 30 }, (_, i) => ({
        id: `d${i}`,
        label: `Diagnostic ${'x'.repeat(200)} ${i}`,
        kind: 'diagnostic' as const,
      })),
      metadata: Object.fromEntries(
        Array.from({ length: 15 }, (_, i) => [`key${i}`, 'v'.repeat(300)])
      ),
    }
    expectBlockKit(buildSlackBotDetails(huge, [ACK]).blocks ?? [])
  })
})
