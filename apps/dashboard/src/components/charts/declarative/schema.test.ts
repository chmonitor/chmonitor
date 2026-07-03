import { validateDeclarativeChart } from './validate'
import { describe, expect, test } from 'bun:test'

describe('minimal valid area chart', () => {
  test('accepts chartName + type + index + categories', () => {
    const result = validateDeclarativeChart({
      type: 'area',
      chartName: 'my-area-chart',
      index: 'event_time',
      categories: ['value'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.chart.chartName).toBe('my-area-chart')
    expect(result.chart.type).toBe('area')
  })
})

describe('minimal valid bar chart', () => {
  test('accepts chartName + type + index + categories', () => {
    const result = validateDeclarativeChart({
      type: 'bar',
      chartName: 'my-bar-chart',
      index: 'query_type',
      categories: ['count'],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.chart.type).toBe('bar')
  })
})

describe('full-featured area chart', () => {
  test('accepts every serializable field', () => {
    const result = validateDeclarativeChart({
      type: 'area',
      chartName: 'query-count',
      description: 'Query volume over time',
      icon: 'bar-chart-3',
      index: 'event_time',
      categories: ['query_count'],
      defaultTitle: 'Query Count',
      defaultInterval: 'toStartOfDay',
      defaultLastHours: 336,
      refreshInterval: 60000,
      dataTestId: 'query-count-chart',
      dateRangeConfig: 'query-activity',
      enableScaleToggle: true,
      defaultChartClassName: 'h-full',
      showDeployments: true,
      areaChartProps: {
        colors: ['--chart-yellow'],
        stack: true,
        showLegend: false,
        showXAxis: true,
        showCartesianGrid: true,
        readable: 'quantity',
        breakdown: 'breakdown',
        breakdownLabel: 'query_kind',
        breakdownValue: 'count',
        yAxisTickFormatterKey: 'count',
      },
    })

    expect(result.ok).toBe(true)
  })
})

describe('invalid configs', () => {
  test('rejects missing chartName', () => {
    const result = validateDeclarativeChart({
      type: 'area',
      index: 'event_time',
      categories: ['value'],
    })
    expect(result.ok).toBe(false)
  })

  test('rejects missing type discriminant', () => {
    const result = validateDeclarativeChart({
      chartName: 'no-type',
      index: 'event_time',
      categories: ['value'],
    })
    expect(result.ok).toBe(false)
  })

  test('rejects empty categories', () => {
    const result = validateDeclarativeChart({
      type: 'area',
      chartName: 'empty-categories',
      index: 'event_time',
      categories: [],
    })
    expect(result.ok).toBe(false)
  })

  test('rejects missing index', () => {
    const result = validateDeclarativeChart({
      type: 'bar',
      chartName: 'no-index',
      categories: ['count'],
    })
    expect(result.ok).toBe(false)
  })

  test('rejects unknown dateRangeConfig preset', () => {
    const result = validateDeclarativeChart({
      type: 'area',
      chartName: 'bad-preset',
      index: 'event_time',
      categories: ['value'],
      dateRangeConfig: 'not-a-real-preset',
    })
    expect(result.ok).toBe(false)
  })

  test('rejects unknown ClickHouse interval', () => {
    const result = validateDeclarativeChart({
      type: 'area',
      chartName: 'bad-interval',
      index: 'event_time',
      categories: ['value'],
      defaultInterval: 'toStartOfDecade',
    })
    expect(result.ok).toBe(false)
  })

  test('rejects an unknown lucide icon name', () => {
    const result = validateDeclarativeChart({
      type: 'area',
      chartName: 'bad-icon',
      index: 'event_time',
      categories: ['value'],
      icon: 'this-icon-does-not-exist-in-lucide',
    })
    expect(result.ok).toBe(false)
  })

  test('accepts a real lucide icon name', () => {
    const result = validateDeclarativeChart({
      type: 'area',
      chartName: 'good-icon',
      index: 'event_time',
      categories: ['value'],
      icon: 'database',
    })
    expect(result.ok).toBe(true)
  })

  test('rejects an unknown yAxisTickFormatterKey', () => {
    const result = validateDeclarativeChart({
      type: 'bar',
      chartName: 'bad-formatter',
      index: 'event_time',
      categories: ['value'],
      barChartProps: { yAxisTickFormatterKey: 'not-a-formatter' },
    })
    expect(result.ok).toBe(false)
  })
})
