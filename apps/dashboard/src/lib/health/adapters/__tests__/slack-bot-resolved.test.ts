/**
 * Resolved and trend thread replies from the Slack app. A resolved reply
 * quotes the alert it closes so a reader sees what ended without scrolling
 * up; a trend reply draws the episode's values as a native line chart, or as
 * one text line when there are too few of them or Slack rejects the chart.
 */

import type { AlertPayload } from '../types'

import { buildSlackBotResolved, buildSlackBotTrend } from '../slack'
import { expectBlockKit } from './slack-block-kit'
import { describe, expect, test } from 'bun:test'

const RESOLVED: AlertPayload = {
  severity: 'recovery',
  hostLabel: 'prod-1',
  hostId: 2,
  metric: 'failed-mutations',
  value: 0,
  warnThreshold: 1,
  critThreshold: 5,
  title: 'Failed mutations',
  label: '0 failed mutations',
  timestamp: '2026-07-04T03:00:00.000Z',
  dashboardUrl: 'https://chm.example.com/health?host=2',
  firedForMs: 3 * 3_600_000,
}

const ORIGINAL = {
  title: 'Failed mutations',
  hostLabel: 'prod-1',
  firstFiredAt: '2026-07-04T00:00:00.000Z',
  value: 7,
}

const FOOTER = {
  type: 'context',
  elements: [
    { type: 'mrkdwn', text: 'failed-mutations · 2026-07-04 03:00 UTC' },
  ],
}

const sectionText = (blocks: readonly unknown[] | undefined) =>
  (blocks?.[0] as { text: { text: string } }).text.text

describe('buildSlackBotResolved', () => {
  test('quotes the original alert under a one-line resolution', () => {
    expect(
      buildSlackBotResolved(RESOLVED, {
        ...ORIGINAL,
        severity: 'critical',
        peak: 9,
      })
    ).toEqual({
      text: 'Resolved: Failed mutations on prod-1',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              '🟢 *RESOLVED*  Failed mutations · prod-1 · resolved after 3 h · peak 9 · last 0 · <https://chm.example.com/health?host=2|Open>',
              '> 🔴 *CRITICAL*  Failed mutations · prod-1 · 7 · fired 2026-07-04 00:00 UTC',
            ].join('\n'),
          },
        },
        FOOTER,
      ],
    })
  })

  test('without the original it is the resolution line and the footer', () => {
    expect(buildSlackBotResolved(RESOLVED).blocks).toEqual([
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '🟢 *RESOLVED*  Failed mutations · prod-1 · resolved after 3 h · last 0 · <https://chm.example.com/health?host=2|Open>',
        },
      },
      FOOTER,
    ])
  })

  test('the duration falls back to the first fire time', () => {
    const text = sectionText(
      buildSlackBotResolved(
        {
          ...RESOLVED,
          firedForMs: undefined,
          timestamp: '2026-07-04T00:35:00.000Z',
          dashboardUrl: undefined,
        },
        ORIGINAL
      ).blocks
    )
    expect(text).toBe(
      [
        '🟢 *RESOLVED*  Failed mutations · prod-1 · resolved after 35 min · last 0',
        '> Failed mutations · prod-1 · 7 · fired 2026-07-04 00:00 UTC',
      ].join('\n')
    )
  })

  test('an unknown or impossible duration is left out', () => {
    const lead = (firstFiredAt: string) =>
      sectionText(
        buildSlackBotResolved(
          {
            ...RESOLVED,
            firedForMs: undefined,
            value: null,
            dashboardUrl: undefined,
          },
          { ...ORIGINAL, firstFiredAt, value: null }
        ).blocks
      ).split('\n')[0]
    expect(lead('not a date')).toBe('🟢 *RESOLVED*  Failed mutations · prod-1')
    expect(lead('2026-07-05T00:00:00.000Z')).toBe(
      '🟢 *RESOLVED*  Failed mutations · prod-1'
    )
  })

  test('every quoted line stays inside the quote and is escaped', () => {
    const text = sectionText(
      buildSlackBotResolved(RESOLVED, {
        ...ORIGINAL,
        title: 'a <!channel>\n> b',
      }).blocks
    )
    const [, ...quoted] = text.split('\n')
    expect(quoted).toEqual([
      '> a &lt;!channel&gt;',
      '> &gt; b · prod-1 · 7 · fired 2026-07-04 00:00 UTC',
    ])
  })

  test('stays inside Block Kit limits for oversized input', () => {
    const resolved = buildSlackBotResolved(
      {
        ...RESOLVED,
        title: 'T'.repeat(5000),
        metadata: Object.fromEntries(
          Array.from({ length: 15 }, (_, i) => [`k${i}`, 'v'.repeat(300)])
        ),
      },
      { ...ORIGINAL, title: '>'.repeat(3000), hostLabel: 'h'.repeat(3000) }
    )
    expectBlockKit(resolved.blocks ?? [])
  })
})

describe('buildSlackBotTrend', () => {
  const FIRING: AlertPayload = {
    ...RESOLVED,
    severity: 'critical',
    value: 97,
    warnThreshold: 80,
    critThreshold: 90,
    title: 'Memory usage',
    label: 'memory 97%',
    metric: 'memory-usage',
    firedForMs: undefined,
    dashboardUrl: undefined,
  }

  /** Values five minutes apart, the last at the alert's time (03:00). */
  const points = (values: readonly (number | null)[]) =>
    values.map((value, i) => ({
      at: new Date(
        Date.parse(FIRING.timestamp) - (values.length - 1 - i) * 300_000
      ).toISOString(),
      value,
    }))
  const HEAD = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: [
        '🔴 *CRITICAL*  Memory usage · prod-1 · 97 (warn 80, crit 90)',
        'memory 97%',
      ].join('\n'),
    },
  }
  const TREND_FOOTER = {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: 'memory-usage · 2026-07-04 03:00 UTC' }],
  }
  const flat = (name: string, value: number) => ({
    name,
    data: ['02:50', '02:55', '03:00'].map((label) => ({ label, value })),
  })

  test('three or more timed values become a native line chart above the footer', () => {
    expect(buildSlackBotTrend(FIRING, points([55, 80, 97]))).toEqual({
      text: 'Details: Memory usage on prod-1',
      blocks: [
        HEAD,
        {
          type: 'data_visualization',
          title: 'Memory usage',
          chart: {
            type: 'line',
            series: [
              {
                name: 'memory-usage',
                data: [
                  { label: '02:50', value: 55 },
                  { label: '02:55', value: 80 },
                  { label: '03:00', value: 97 },
                ],
              },
              flat('warn', 80),
              flat('crit', 90),
            ],
            axis_config: {
              categories: ['02:50', '02:55', '03:00'],
              x_label: 'UTC',
              y_label: 'memory-usage',
            },
          },
        },
        TREND_FOOTER,
      ],
    })
  })

  test('the chart sits above the Acknowledge button', () => {
    const ack = { type: 'actions', elements: [] }
    expect(
      buildSlackBotTrend(FIRING, points([55, 80, 97]), [ack]).blocks?.map(
        (b) => (b as { type: string }).type
      )
    ).toEqual(['section', 'data_visualization', 'actions', 'context'])
  })

  test('one or two values draw the sparkline instead', () => {
    expect(buildSlackBotTrend(FIRING, points([85, 97])).blocks).toEqual([
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '🔴 *CRITICAL*  Memory usage · prod-1 · 97 (warn 80, crit 90)',
            'memory 97%',
            '`▁█ 85 → 97 (warn 80, crit 90)`',
          ].join('\n'),
        },
      },
      TREND_FOOTER,
    ])
  })

  test('without the chart every value is a sparkline, for a surface that rejects the block', () => {
    expect(
      sectionText(
        buildSlackBotTrend(FIRING, points([12, 30, 55, 80, 97]), [], {
          chart: false,
        }).blocks
      )
    ).toBe(
      [
        '🔴 *CRITICAL*  Memory usage · prod-1 · 97 (warn 80, crit 90)',
        'memory 97%',
        '`▁▂▅▇█ 12 → 97 (warn 80, crit 90)`',
      ].join('\n')
    )
  })

  test('a series with no usable point adds nothing', () => {
    expect(
      buildSlackBotTrend(FIRING, points([null, Number.NaN, null])).blocks
    ).toEqual([HEAD, TREND_FOOTER])
  })
})
