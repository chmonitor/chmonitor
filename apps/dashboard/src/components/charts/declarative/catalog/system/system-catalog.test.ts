/**
 * Parity tests for the system/ domain declarative chart catalog
 * (plans/58-declarative-chart-schema.md). See query-catalog.test.ts for the
 * parity-testing philosophy this mirrors.
 */

import { createChartFromDeclarative, loadDeclarativeChart } from '../../loader'
import { cpuUsageDeclarative } from './cpu-usage'
import { memoryUsageDeclarative } from './memory-usage'
import { describe, expect, test } from 'bun:test'
import { chartTickFormatters } from '@/lib/utils'

describe('memory-usage declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeChart(memoryUsageDeclarative)).not.toThrow()
  })

  test('config matches the hand-authored createAreaChart call', () => {
    const loaded = loadDeclarativeChart(memoryUsageDeclarative)
    expect(loaded.kind).toBe('area')
    expect(loaded.config).toEqual({
      chartName: 'memory-usage',
      index: 'event_time',
      categories: ['avg_memory'],
      defaultInterval: 'toStartOfTenMinutes',
      defaultLastHours: 24,
      dataTestId: 'memory-usage-chart',
      dateRangeConfig: 'system-metrics',
      areaChartProps: {
        colors: ['--chart-12'],
        yAxisTickFormatter: chartTickFormatters.bytes,
      },
    })
  })

  test('renders through createAreaChart without throwing', () => {
    expect(() =>
      createChartFromDeclarative(memoryUsageDeclarative)
    ).not.toThrow()
  })
})

describe('cpu-usage declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeChart(cpuUsageDeclarative)).not.toThrow()
  })

  test('config matches the hand-authored createAreaChart call', () => {
    const loaded = loadDeclarativeChart(cpuUsageDeclarative)
    expect(loaded.kind).toBe('area')
    expect(loaded.config).toEqual({
      chartName: 'cpu-usage',
      index: 'event_time',
      categories: ['avg_cpu'],
      defaultInterval: 'toStartOfTenMinutes',
      defaultLastHours: 24,
      dataTestId: 'cpu-usage-chart',
      dateRangeConfig: 'system-metrics',
      areaChartProps: {
        colors: ['--chart-1'],
        yAxisTickFormatter: chartTickFormatters.duration,
      },
    })
  })

  test('renders through createAreaChart without throwing', () => {
    expect(() => createChartFromDeclarative(cpuUsageDeclarative)).not.toThrow()
  })
})
