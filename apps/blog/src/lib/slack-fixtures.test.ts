import { GROUPED_BAR, LINE_WITH_THRESHOLDS, PIE } from './slack-chart-samples'
import { firstChartSeries, parseSlackDemo } from './slack-fixtures'
import { describe, expect, test } from 'bun:test'

function demoWith(
  blocks: unknown[],
  color = '#f59e0b',
  topLevel: unknown[] = []
) {
  const message = {
    author: 'bot',
    ts: '2026-11-16T09:12:00.000Z',
    body: { blocks: topLevel, attachments: [{ color, blocks }] },
  }
  const thread = { parent: message, replies: [] }
  return {
    channel: 'alerts',
    authors: { webhook: { name: 'w' }, bot: { name: 'b' } },
    users: {},
    threads: {
      webhook: thread,
      newAlert: thread,
      escalation: thread,
      ack: thread,
      resolved: thread,
    },
  }
}

describe('parseSlackDemo', () => {
  test('a block type the components cannot draw fails loudly', () => {
    expect(() => parseSlackDemo(demoWith([{ type: 'image' }]))).toThrow(
      'Slack demo: no renderer for block type "image"'
    )
  })

  test('a field the components do not draw fails loudly', () => {
    const section = {
      type: 'section',
      text: { type: 'mrkdwn', text: 'x' },
      accessory: { type: 'image' },
    }
    expect(() => parseSlackDemo(demoWith([section]))).toThrow(
      'Slack demo: section field "accessory" is not drawn'
    )
  })

  test('an attachment colour that is not #rrggbb is rejected', () => {
    expect(() =>
      parseSlackDemo(demoWith([{ type: 'divider' }], 'red;background:url(x)'))
    ).toThrow(
      'Slack demo: attachment colour "red;background:url(x)" is not #rrggbb'
    )
  })

  test('a data_visualization block within the documented limits is drawn', () => {
    const demo = parseSlackDemo(demoWith([], '#f59e0b', [LINE_WITH_THRESHOLDS]))
    expect(demo.threads.newAlert.parent.body.blocks).toEqual([
      LINE_WITH_THRESHOLDS,
    ])
  })

  test('a data_visualization block over a documented limit fails the build', () => {
    const tooLong = { ...PIE, title: 'x'.repeat(51) }
    expect(() => parseSlackDemo(demoWith([], '#f59e0b', [tooLong]))).toThrow(
      'Slack demo: data_visualization: title is 51 characters, max 50'
    )
  })

  test('Slack allows two charts in a message, not three', () => {
    expect(() =>
      parseSlackDemo(demoWith([PIE], '#f59e0b', [GROUPED_BAR]))
    ).not.toThrow()
    expect(() =>
      parseSlackDemo(
        demoWith([PIE], '#f59e0b', [GROUPED_BAR, LINE_WITH_THRESHOLDS])
      )
    ).toThrow(
      'Slack demo: a message has 3 data_visualization blocks, Slack allows 2'
    )
  })
})

describe('firstChartSeries', () => {
  const message = (blocks: unknown[]) =>
    ({
      author: 'bot',
      ts: '2026-11-16T09:47:00.000Z',
      body: { blocks },
    }) as Parameters<typeof firstChartSeries>[0]

  test('reads the first series of the chart, not the thresholds', () => {
    expect(
      firstChartSeries(message([{ type: 'divider' }, LINE_WITH_THRESHOLDS]))
    ).toEqual([
      71, 72, 72, 73, 73, 74, 75, 75, 76, 77, 78, 79, 84, 85, 86, 88, 90, 92,
      94, 96,
    ])
  })

  test('a message with no axis chart fails the build', () => {
    expect(() => firstChartSeries(message([PIE]))).toThrow(
      'Slack demo: the message has no line, area or bar chart'
    )
  })
})
