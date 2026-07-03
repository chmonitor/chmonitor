import type { DeclarativeAreaChart, DeclarativeBarChart } from './schema'

import {
  buildAreaChartConfig,
  buildBarChartConfig,
  createChartFromDeclarative,
  loadDeclarativeChart,
} from './loader'
import { describe, expect, test } from 'bun:test'
import { chartTickFormatters } from '@/lib/utils'

describe('buildAreaChartConfig', () => {
  test('maps required fields', () => {
    const d: DeclarativeAreaChart = {
      type: 'area',
      chartName: 'cpu-usage',
      index: 'event_time',
      categories: ['avg_cpu'],
    }
    const config = buildAreaChartConfig(d)
    expect(config).toEqual({
      chartName: 'cpu-usage',
      index: 'event_time',
      categories: ['avg_cpu'],
    })
  })

  test('resolves yAxisTickFormatterKey to the matching chartTickFormatters fn', () => {
    const d: DeclarativeAreaChart = {
      type: 'area',
      chartName: 'memory-usage',
      index: 'event_time',
      categories: ['avg_memory'],
      areaChartProps: {
        colors: ['--chart-12'],
        yAxisTickFormatterKey: 'bytes',
      },
    }
    const config = buildAreaChartConfig(d)
    expect(config.areaChartProps?.yAxisTickFormatter).toBe(
      chartTickFormatters.bytes
    )
    expect(config.areaChartProps?.colors).toEqual(['--chart-12'])
    // yAxisTickFormatterKey itself must not leak onto the factory config —
    // AreaChartFactoryConfig has no such field.
    expect(
      (config.areaChartProps as Record<string, unknown>).yAxisTickFormatterKey
    ).toBeUndefined()
  })

  test('omits undefined optional fields entirely', () => {
    const d: DeclarativeAreaChart = {
      type: 'area',
      chartName: 'minimal',
      index: 'event_time',
      categories: ['v'],
    }
    const config = buildAreaChartConfig(d)
    expect('defaultTitle' in config).toBe(false)
    expect('showDeployments' in config).toBe(false)
    expect('areaChartProps' in config).toBe(false)
  })
})

describe('buildBarChartConfig', () => {
  test('maps required + optional fields', () => {
    const d: DeclarativeBarChart = {
      type: 'bar',
      chartName: 'zookeeper-requests',
      index: 'event_time',
      categories: ['ZookeeperRequests', 'ZooKeeperWatch'],
      defaultTitle: 'ZooKeeper Requests',
      xAxisDateFormat: true,
      barChartProps: {
        showLegend: true,
        stack: true,
        yAxisTickFormatterKey: 'count',
      },
    }
    const config = buildBarChartConfig(d)
    expect(config.chartName).toBe('zookeeper-requests')
    expect(config.xAxisDateFormat).toBe(true)
    expect(config.barChartProps?.yAxisTickFormatter).toBe(
      chartTickFormatters.count
    )
    expect(config.barChartProps?.showLegend).toBe(true)
    expect(config.barChartProps?.stack).toBe(true)
  })
})

describe('loadDeclarativeChart', () => {
  test('tags area definitions with kind: area', () => {
    const loaded = loadDeclarativeChart({
      type: 'area',
      chartName: 'query-count',
      index: 'event_time',
      categories: ['query_count'],
    })
    expect(loaded.kind).toBe('area')
  })

  test('tags bar definitions with kind: bar', () => {
    const loaded = loadDeclarativeChart({
      type: 'bar',
      chartName: 'query-type',
      index: 'query_type',
      categories: ['count'],
    })
    expect(loaded.kind).toBe('bar')
  })

  test('throws with field-level errors on invalid input', () => {
    expect(() => loadDeclarativeChart({ type: 'area' })).toThrow(
      /Invalid declarative chart/
    )
  })
})

describe('createChartFromDeclarative', () => {
  test('renders through the same factory as a hand-authored area chart', () => {
    const Chart = createChartFromDeclarative({
      type: 'area',
      chartName: 'query-count',
      index: 'event_time',
      categories: ['query_count'],
    })
    expect(typeof Chart).toBe('object') // React.memo() returns an object, not a function
  })

  test('renders through the same factory as a hand-authored bar chart', () => {
    const Chart = createChartFromDeclarative({
      type: 'bar',
      chartName: 'zookeeper-requests',
      index: 'event_time',
      categories: ['ZookeeperRequests'],
    })
    expect(typeof Chart).toBe('object')
  })

  test('throws on an invalid declarative definition instead of rendering nothing', () => {
    expect(() => createChartFromDeclarative({ type: 'bar' })).toThrow()
  })
})
