import { validateDataVisualization } from './slack-chart-block'
import { GROUPED_BAR, LINE_WITH_THRESHOLDS, PIE } from './slack-chart-samples'
import { describe, expect, test } from 'bun:test'

const PREFIX = 'Slack demo: data_visualization'

/** A copy of `block` with `change` applied, so each case breaks one rule. */
function broken(block: object, change: (b: any) => void): unknown {
  const copy = structuredClone(block)
  change(copy)
  return copy
}

const axisChart = (labels: string[], values: number[], name = 'p50') => ({
  type: 'data_visualization',
  title: 'Query latency',
  chart: {
    type: 'line',
    series: [
      { name, data: labels.map((label, i) => ({ label, value: values[i] })) },
    ],
    axis_config: { categories: labels },
  },
})

describe('validateDataVisualization accepts what Slack documents', () => {
  test.each([
    ['line with warn and crit series', LINE_WITH_THRESHOLDS],
    ['grouped bar with points out of category order', GROUPED_BAR],
    ['pie', PIE],
  ])('%s', (_, block) => {
    expect(validateDataVisualization(block)).toEqual(block)
  })

  test('limits are inclusive: 50-char title, 12 series, 20 points, 20-char labels', () => {
    const labels = Array.from({ length: 20 }, (_, i) =>
      `${i}`.padStart(20, 'x')
    )
    const block = {
      type: 'data_visualization',
      title: 't'.repeat(50),
      chart: {
        type: 'area',
        series: Array.from({ length: 12 }, (_, s) => ({
          name: `series ${s}`.padEnd(20, '.'),
          data: labels.map((label) => ({ label, value: -s })),
        })),
        axis_config: {
          categories: labels,
          x_label: 'x'.repeat(50),
          y_label: 'y'.repeat(50),
        },
      },
    }
    expect(validateDataVisualization(block)).toEqual(block)
  })

  test('a 12-slice pie with 20-char labels passes', () => {
    const block = {
      type: 'data_visualization',
      title: 'Slices',
      chart: {
        type: 'pie',
        segments: Array.from({ length: 12 }, (_, i) => ({
          label: `slice ${i}`.padEnd(20, '.'),
          value: 0.5,
        })),
      },
    }
    expect(validateDataVisualization(block)).toEqual(block)
  })
})

describe('validateDataVisualization rejects each documented limit', () => {
  test.each([
    [
      'title over 50 characters',
      broken(PIE, (b) => {
        b.title = 'x'.repeat(51)
      }),
      `${PREFIX}: title is 51 characters, max 50`,
    ],
    [
      'missing title',
      broken(PIE, (b) => {
        delete b.title
      }),
      `${PREFIX}: title is required`,
    ],
    [
      'a chart type Slack does not have',
      broken(PIE, (b) => {
        b.chart.type = 'scatter'
      }),
      `${PREFIX} "Open alerts by rule": chart.type "scatter" is not pie, bar, area or line`,
    ],
    [
      'a pie with no segments',
      broken(PIE, (b) => {
        b.chart.segments = []
      }),
      `${PREFIX} "Open alerts by rule": chart.segments has 0 items, needs 1 to 12`,
    ],
    [
      'a pie with 13 segments',
      broken(PIE, (b) => {
        b.chart.segments = Array.from({ length: 13 }, (_, i) => ({
          label: `s${i}`,
          value: 1,
        }))
      }),
      `${PREFIX} "Open alerts by rule": chart.segments has 13 items, needs 1 to 12`,
    ],
    [
      'a pie label over 20 characters',
      broken(PIE, (b) => {
        b.chart.segments[1].label = 'replication-lag-seconds'
      }),
      `${PREFIX} "Open alerts by rule": chart.segments[1].label is 23 characters, max 20`,
    ],
    [
      'a pie slice of zero',
      broken(PIE, (b) => {
        b.chart.segments[2].value = 0
      }),
      `${PREFIX} "Open alerts by rule": chart.segments[2].value must be greater than 0`,
    ],
    [
      '13 series',
      broken(GROUPED_BAR, (b) => {
        b.chart.series = Array.from({ length: 13 }, (_, i) => ({
          name: `s${i}`,
          data: b.chart.series[0].data,
        }))
      }),
      `${PREFIX} "Failed queries by host": chart.series has 13 items, needs 1 to 12`,
    ],
    [
      'a series name over 20 characters',
      broken(GROUPED_BAR, (b) => {
        b.chart.series[1].name = 'Dunder Mifflin Infinity Website'
      }),
      `${PREFIX} "Failed queries by host": chart.series[1].name is 31 characters, max 20`,
    ],
    [
      'two series with one name',
      broken(GROUPED_BAR, (b) => {
        b.chart.series[1].name = 'today'
      }),
      `${PREFIX} "Failed queries by host": chart.series[1].name "today" is used twice`,
    ],
    [
      '21 points',
      axisChart(
        Array.from({ length: 21 }, (_, i) => `t${i}`),
        Array.from({ length: 21 }, () => 5)
      ),
      `${PREFIX} "Query latency": chart.series[0].data has 21 items, needs 1 to 20`,
    ],
    [
      'a category over 20 characters',
      axisChart(['2026-11-16 09:12 UTC+7'], [5]),
      `${PREFIX} "Query latency": chart.axis_config.categories[0] is 22 characters, max 20`,
    ],
    [
      'an x_label over 50 characters',
      broken(LINE_WITH_THRESHOLDS, (b) => {
        b.chart.axis_config.x_label = 'x'.repeat(51)
      }),
      `${PREFIX} "Disk used on prod-ch-1": chart.axis_config.x_label is 51 characters, max 50`,
    ],
    [
      'a y_label over 50 characters',
      broken(LINE_WITH_THRESHOLDS, (b) => {
        b.chart.axis_config.y_label = 'y'.repeat(51)
      }),
      `${PREFIX} "Disk used on prod-ch-1": chart.axis_config.y_label is 51 characters, max 50`,
    ],
    [
      'a series that skips a category',
      broken(GROUPED_BAR, (b) => {
        b.chart.series[1].data.pop()
      }),
      `${PREFIX} "Failed queries by host": chart.series[1].data has no point for "prod-ch-2"`,
    ],
    [
      'a point whose label is not a category',
      broken(GROUPED_BAR, (b) => {
        b.chart.series[0].data[2].label = 'prod-ch-9'
      }),
      `${PREFIX} "Failed queries by host": chart.series[0].data[2].label "prod-ch-9" is not in axis_config.categories`,
    ],
    [
      'two points for one category',
      broken(GROUPED_BAR, (b) => {
        b.chart.series[0].data[2].label = 'prod-ch-1'
      }),
      `${PREFIX} "Failed queries by host": chart.series[0].data has two points for "prod-ch-1"`,
    ],
    [
      'a category listed twice',
      axisChart(['p', 'p'], [1, 2]),
      `${PREFIX} "Query latency": chart.axis_config.categories has "p" twice`,
    ],
    [
      'a value that is not a number',
      broken(LINE_WITH_THRESHOLDS, (b) => {
        b.chart.series[0].data[4].value = '73'
      }),
      `${PREFIX} "Disk used on prod-ch-1": chart.series[0].data[4].value is not a number`,
    ],
    [
      'no axis_config on a line chart',
      broken(LINE_WITH_THRESHOLDS, (b) => {
        delete b.chart.axis_config
      }),
      `${PREFIX} "Disk used on prod-ch-1": chart.axis_config is required`,
    ],
    [
      'a chart field the page does not draw',
      broken(PIE, (b) => {
        b.chart.colors = ['#f00']
      }),
      `${PREFIX} "Open alerts by rule": chart field "colors" is not drawn`,
    ],
  ])('%s', (_, block, message) => {
    expect(() => validateDataVisualization(block)).toThrow(message)
  })
})
