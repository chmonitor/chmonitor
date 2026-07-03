/**
 * Parity test for the logs/ domain declarative chart catalog
 * (plans/58-declarative-chart-schema.md). See
 * ../query/query-catalog.test.ts for the parity-testing philosophy this
 * mirrors. This is the catalog's multi-category + legend example.
 */

import { createChartFromDeclarative, loadDeclarativeChart } from '../../loader'
import { errorRateOverTimeDeclarative } from './error-rate-over-time'
import { describe, expect, test } from 'bun:test'
import { chartTickFormatters } from '@/lib/utils'

describe('error-rate-over-time declarative', () => {
  test('loads without error', () => {
    expect(() =>
      loadDeclarativeChart(errorRateOverTimeDeclarative)
    ).not.toThrow()
  })

  test('config matches the hand-authored createAreaChart call', () => {
    const loaded = loadDeclarativeChart(errorRateOverTimeDeclarative)
    expect(loaded.kind).toBe('area')
    expect(loaded.config).toEqual({
      chartName: 'error-rate-over-time',
      index: 'event_time',
      categories: ['error_count', 'warning_count', 'info_count'],
      defaultTitle: 'Error Rate Over Time',
      defaultInterval: 'toStartOfHour',
      defaultLastHours: 24,
      dataTestId: 'error-rate-over-time-chart',
      dateRangeConfig: 'realtime',
      areaChartProps: {
        readable: 'quantity',
        stack: true,
        showLegend: true,
        showXAxis: true,
        showCartesianGrid: true,
        colors: ['--chart-red', '--chart-yellow', '--chart-blue'],
        yAxisTickFormatter: chartTickFormatters.count,
      },
    })
  })

  test('renders through createAreaChart without throwing', () => {
    expect(() =>
      createChartFromDeclarative(errorRateOverTimeDeclarative)
    ).not.toThrow()
  })
})
