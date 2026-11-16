/**
 * Slack charts for an alert's recent values. The native line chart
 * (data_visualization block) must never break a documented limit, since Slack
 * rejects the whole message for one bad block. The sparkline is the text
 * fallback; its arrow reads first → last value, so a falling series must
 * read as falling.
 */

import {
  buildSlackLineChart,
  buildSlackSparkline,
  type SlackDataVisualizationBlock,
  type SlackSeriesChart,
  validateDataVisualization,
} from '../slack-chart'
import { describe, expect, test } from 'bun:test'

describe('buildSlackSparkline', () => {
  test('a rising series with its threshold', () => {
    expect(buildSlackSparkline([12, 30, 55, 80, 97], { warn: 80 })).toBe(
      '`▁▂▅▇█ 12 → 97 (warn 80)`'
    )
  })

  test('a falling series reads first → last, not min → max', () => {
    expect(buildSlackSparkline([97, 80, 55, 30, 12])).toBe('`█▇▅▂▁ 97 → 12`')
  })

  test('labels the min or max only when neither end shows it', () => {
    expect(buildSlackSparkline([50, 10, 60, 100])).toBe(
      '`▄▁▅█ 50 → 100 (min 10)`'
    )
    expect(buildSlackSparkline([10, 90, 20], { warn: 80, crit: 90 })).toBe(
      '`▁█▂ 10 → 20 (max 90, warn 80, crit 90)`'
    )
  })

  test('no usable point draws nothing', () => {
    expect(buildSlackSparkline([])).toBe('')
    expect(
      buildSlackSparkline([Number.NaN, Number.POSITIVE_INFINITY, null])
    ).toBe('')
  })

  test('one point is one mid bar and its value', () => {
    expect(buildSlackSparkline([42], { warn: 80, crit: null })).toBe(
      '`▄ 42 (warn 80)`'
    )
  })

  test('a constant series is flat at mid height', () => {
    expect(buildSlackSparkline([5, 5, 5])).toBe('`▄▄▄ 5 → 5`')
  })

  test('gaps (NaN, null, undefined) are skipped', () => {
    expect(buildSlackSparkline([1, Number.NaN, null, undefined, 3])).toBe(
      '`▁█ 1 → 3`'
    )
  })

  test('decimals round to two places and negatives scale', () => {
    expect(buildSlackSparkline([0.123, 2.5])).toBe('`▁█ 0.12 → 2.5`')
    expect(buildSlackSparkline([-5, 0, 5])).toBe('`▁▅█ -5 → 5`')
  })

  test('a long series is cut to the width and keeps its spike', () => {
    const values = Array.from({ length: 1000 }, (_, i) =>
      i === 500 ? 500 : 10
    )
    expect(buildSlackSparkline(values)).toBe(
      `\`${'▁'.repeat(12)}█${'▁'.repeat(11)} 10 → 10 (max 500)\``
    )
    expect(buildSlackSparkline(values, { width: 4 })).toBe(
      '`▁▁█▁ 10 → 10 (max 500)`'
    )
  })
})

const at = (hhmm: string, day = '2026-11-16') => `${day}T${hhmm}:00.000Z`

const DISK = {
  title: 'Disk usage',
  metric: 'disk-usage',
  warn: 80,
  crit: 90,
}

/** The value series of a chart, as label → value pairs. */
function valuesOf(block: SlackDataVisualizationBlock | null) {
  if (!block || block.chart.type === 'pie') return null
  return block.chart.series[0].data.map((p) => `${p.label}=${p.value}`)
}

describe('buildSlackLineChart', () => {
  test('an episode becomes a line chart with constant warn and crit lines', () => {
    expect(
      buildSlackLineChart({
        ...DISK,
        points: [
          { at: at('09:00'), value: 84 },
          { at: at('09:05'), value: 88 },
          { at: at('09:10'), value: 96 },
        ],
      })
    ).toEqual({
      type: 'data_visualization',
      title: 'Disk usage',
      chart: {
        type: 'line',
        series: [
          {
            name: 'disk-usage',
            data: [
              { label: '09:00', value: 84 },
              { label: '09:05', value: 88 },
              { label: '09:10', value: 96 },
            ],
          },
          {
            name: 'warn',
            data: [
              { label: '09:00', value: 80 },
              { label: '09:05', value: 80 },
              { label: '09:10', value: 80 },
            ],
          },
          {
            name: 'crit',
            data: [
              { label: '09:00', value: 90 },
              { label: '09:05', value: 90 },
              { label: '09:10', value: 90 },
            ],
          },
        ],
        axis_config: {
          categories: ['09:00', '09:05', '09:10'],
          x_label: 'UTC',
          y_label: 'disk-usage',
        },
      },
    })
  })

  test('the unit names the y axis when there is one', () => {
    const block = buildSlackLineChart({
      title: 'Memory',
      metric: 'memory-usage',
      unit: '%',
      points: [
        { at: at('09:00'), value: 1 },
        { at: at('09:01'), value: 2 },
        { at: at('09:02'), value: 3 },
      ],
    })
    expect(block?.chart).toMatchObject({
      axis_config: { y_label: '%' },
      series: [{ name: 'memory-usage' }],
    })
  })

  test('only finite thresholds get a line', () => {
    const block = buildSlackLineChart({
      ...DISK,
      warn: null,
      crit: Number.NaN,
      points: [
        { at: at('09:00'), value: 1 },
        { at: at('09:01'), value: 2 },
        { at: at('09:02'), value: 3 },
      ],
    })
    expect(
      block?.chart.type === 'line' && block.chart.series.map((s) => s.name)
    ).toEqual(['disk-usage'])
  })

  test('more than 20 points are cut to 20, each ending at its last time', () => {
    const points = Array.from({ length: 24 }, (_, i) => ({
      at: new Date(Date.parse(at('09:00')) + i * 5 * 60_000).toISOString(),
      value: i,
    }))
    expect(valuesOf(buildSlackLineChart({ ...DISK, points }))).toEqual([
      '09:00=0',
      '09:05=1',
      '09:10=2',
      '09:15=3',
      '09:25=5',
      '09:30=6',
      '09:35=7',
      '09:40=8',
      '09:45=9',
      '09:55=11',
      '10:00=12',
      '10:05=13',
      '10:10=14',
      '10:15=15',
      '10:25=17',
      '10:30=18',
      '10:35=19',
      '10:40=20',
      '10:45=21',
      '10:55=23',
    ])
  })

  test('a bucket keeps its spike, not its last value', () => {
    const points = Array.from({ length: 24 }, (_, i) => ({
      at: new Date(Date.parse(at('09:00')) + i * 60_000).toISOString(),
      value: i === 4 ? 500 : 10,
    }))
    expect(valuesOf(buildSlackLineChart({ ...DISK, points }))?.[4]).toBe(
      '09:05=500'
    )
  })

  test('rows in one minute fold into one point at their max', () => {
    expect(
      valuesOf(
        buildSlackLineChart({
          ...DISK,
          points: [
            { at: '2026-11-16T09:00:05.000Z', value: 85 },
            { at: '2026-11-16T09:00:40.000Z', value: 99 },
            { at: at('09:05'), value: 90 },
            { at: at('09:10'), value: 91 },
          ],
        })
      )
    ).toEqual(['09:00=99', '09:05=90', '09:10=91'])
  })

  test('a span across UTC midnight puts the day in each label', () => {
    expect(
      valuesOf(
        buildSlackLineChart({
          ...DISK,
          points: [
            { at: at('23:50', '2026-11-15'), value: 1 },
            { at: at('23:55', '2026-11-15'), value: 2 },
            { at: at('00:00'), value: 3 },
          ],
        })
      )
    ).toEqual(['11-15 23:50=1', '11-15 23:55=2', '11-16 00:00=3'])
  })

  test('points out of order are drawn in time order', () => {
    expect(
      valuesOf(
        buildSlackLineChart({
          ...DISK,
          points: [
            { at: at('09:10'), value: 3 },
            { at: at('09:00'), value: 1 },
            { at: at('09:05'), value: 2 },
          ],
        })
      )
    ).toEqual(['09:00=1', '09:05=2', '09:10=3'])
  })

  test('fewer than 3 usable points draw no chart', () => {
    expect(
      buildSlackLineChart({
        ...DISK,
        points: [
          { at: at('09:00'), value: 1 },
          { at: at('09:05'), value: null },
          { at: at('09:10'), value: Number.NaN },
          { at: 'not a time', value: 4 },
          { at: '2026-11-16T09:15:20.000Z', value: 5 },
          { at: '2026-11-16T09:15:50.000Z', value: 6 },
        ],
      })
    ).toBeNull()
  })

  test('a long title and metric are cut to the limits', () => {
    const block = buildSlackLineChart({
      title: 'Replication queue size on the busiest replica of the cluster',
      metric: 'replication-queue-size-per-table',
      points: [
        { at: at('09:00'), value: 1 },
        { at: at('09:01'), value: 2 },
        { at: at('09:02'), value: 3 },
      ],
    })
    expect(block?.title).toBe(
      'Replication queue size on the busiest replica of …'
    )
    expect(block?.chart.type === 'line' && block.chart.series[0].name).toBe(
      'replication-queue-s…'
    )
  })

  test('every edge case still gives a block Slack accepts', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      at: new Date(
        Date.parse(at('22:00', '2026-11-15')) + i * 37_000
      ).toISOString(),
      value: Math.sin(i) * 1e6,
    }))
    const block = buildSlackLineChart({
      title: '🔥'.repeat(40),
      metric: '📈'.repeat(30),
      unit: 'x'.repeat(80),
      points: many,
      warn: -1,
      crit: 1e9,
    })
    expect(block && validateDataVisualization(block)).toEqual([])
  })

  test('a metric named like a threshold line draws no chart rather than an invalid one', () => {
    expect(
      buildSlackLineChart({
        title: 'Odd',
        metric: 'warn',
        warn: 1,
        points: [
          { at: at('09:00'), value: 1 },
          { at: at('09:01'), value: 2 },
          { at: at('09:02'), value: 3 },
        ],
      })
    ).toBeNull()
  })
})

const LINE: SlackDataVisualizationBlock = {
  type: 'data_visualization',
  title: 'Disk usage',
  chart: {
    type: 'line',
    series: [
      {
        name: 'disk',
        data: [
          { label: 'a', value: 1 },
          { label: 'b', value: 2 },
        ],
      },
    ],
    axis_config: { categories: ['a', 'b'] },
  },
}

describe('validateDataVisualization', () => {
  const withLine = (
    chart: Partial<SlackSeriesChart>
  ): SlackDataVisualizationBlock => ({
    ...LINE,
    chart: { ...(LINE.chart as SlackSeriesChart), ...chart },
  })

  test('a valid line chart has no problem', () => {
    expect(validateDataVisualization(LINE)).toEqual([])
  })

  test('title: required, at most 50 chars', () => {
    expect(validateDataVisualization({ ...LINE, title: '' })).toEqual([
      'title is empty',
    ])
    expect(
      validateDataVisualization({ ...LINE, title: 'x'.repeat(51) })
    ).toEqual(['title over 50 chars'])
  })

  test('categories: 1 to 20, unique, at most 20 chars each', () => {
    const labels = Array.from({ length: 21 }, (_, i) => `c${i}`)
    expect(
      validateDataVisualization(
        withLine({
          series: [
            {
              name: 'disk',
              data: labels.map((label) => ({ label, value: 1 })),
            },
          ],
          axis_config: { categories: labels },
        })
      )
    ).toEqual(['21 categories'])
    expect(
      validateDataVisualization(
        withLine({
          series: [
            {
              name: 'disk',
              data: [
                { label: 'a', value: 1 },
                { label: 'a', value: 2 },
              ],
            },
          ],
          axis_config: { categories: ['a', 'a'] },
        })
      )
    ).toEqual(['duplicate categories'])
    const long = 'x'.repeat(21)
    expect(
      validateDataVisualization(
        withLine({
          series: [{ name: 'disk', data: [{ label: long, value: 1 }] }],
          axis_config: { categories: [long] },
        })
      )
    ).toEqual(['category 0 over 20 chars'])
  })

  test('axis labels: at most 50 chars', () => {
    expect(
      validateDataVisualization(
        withLine({
          axis_config: {
            categories: ['a', 'b'],
            x_label: 'x'.repeat(51),
            y_label: 'y'.repeat(51),
          },
        })
      )
    ).toEqual(['x_label over 50 chars', 'y_label over 50 chars'])
  })

  test('series: 1 to 12, unique names of at most 20 chars', () => {
    const one = LINE.chart.type === 'line' ? LINE.chart.series[0] : null
    if (!one) throw new Error('LINE is a line chart')
    expect(validateDataVisualization(withLine({ series: [] }))).toEqual([
      '0 series',
    ])
    expect(
      validateDataVisualization(
        withLine({
          series: Array.from({ length: 13 }, (_, i) => ({
            ...one,
            name: `s${i}`,
          })),
        })
      )
    ).toEqual(['13 series'])
    expect(validateDataVisualization(withLine({ series: [one, one] }))).toEqual(
      ['duplicate series names']
    )
    expect(
      validateDataVisualization(
        withLine({ series: [{ ...one, name: 'n'.repeat(21) }] })
      )
    ).toEqual([`series ${'n'.repeat(21)} name over 20 chars`])
  })

  test('each series has exactly one finite point per category', () => {
    expect(
      validateDataVisualization(
        withLine({
          series: [{ name: 'disk', data: [{ label: 'a', value: 1 }] }],
        })
      )
    ).toEqual(['series disk needs one point per category'])
    expect(
      validateDataVisualization(
        withLine({
          series: [
            {
              name: 'disk',
              data: [
                { label: 'a', value: 1 },
                { label: 'c', value: 2 },
              ],
            },
          ],
        })
      )
    ).toEqual(['series disk needs one point per category'])
    expect(
      validateDataVisualization(
        withLine({
          series: [
            {
              name: 'disk',
              data: [
                { label: 'a', value: 1 },
                { label: 'b', value: Number.NaN },
              ],
            },
          ],
        })
      )
    ).toEqual(['series disk value NaN at b'])
  })

  test('pie: 1 to 12 segments, labels of at most 20 chars, values above 0', () => {
    const pie = (segments: { label: string; value: number }[]) =>
      validateDataVisualization({
        type: 'data_visualization',
        title: 'Split',
        chart: { type: 'pie', segments },
      })
    expect(pie([{ label: 'a', value: 1 }])).toEqual([])
    expect(pie([])).toEqual(['0 segments'])
    expect(
      pie(Array.from({ length: 13 }, (_, i) => ({ label: `s${i}`, value: 1 })))
    ).toEqual(['13 segments'])
    expect(pie([{ label: 'x'.repeat(21), value: 1 }])).toEqual([
      'segment 0 label over 20 chars',
    ])
    expect(pie([{ label: 'a', value: 0 }])).toEqual(['segment 0 value 0'])
  })
})
