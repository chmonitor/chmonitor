/**
 * Parity tests for the query/ domain declarative chart catalog
 * (plans/58-declarative-chart-schema.md).
 *
 * For each ported chart, assert that `loadDeclarativeChart(declarativeDef).config`
 * deep-equals the exact config object literal the hand-authored TS chart
 * passes to `createAreaChart`/`createBarChart` (transcribed here from
 * `components/charts/query/query-count.tsx` / `query-duration.tsx`, which stay
 * untouched — see the "Additive only" constraint in the plan). This is the
 * same parity philosophy as
 * `lib/query-config/declarative/catalog/merges/merges-catalog.test.ts`.
 */

import { createChartFromDeclarative, loadDeclarativeChart } from '../../loader'
import { queryCountDeclarative } from './query-count'
import { queryDurationDeclarative } from './query-duration'
import { describe, expect, test } from 'bun:test'
import { chartTickFormatters } from '@/lib/utils'

describe('query-count declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeChart(queryCountDeclarative)).not.toThrow()
  })

  test('config matches the hand-authored createAreaChart call', () => {
    const loaded = loadDeclarativeChart(queryCountDeclarative)
    expect(loaded.kind).toBe('area')
    expect(loaded.config).toEqual({
      chartName: 'query-count',
      index: 'event_time',
      categories: ['query_count'],
      defaultTitle: 'Query Count',
      defaultInterval: 'toStartOfDay',
      defaultLastHours: 24 * 14,
      dataTestId: 'query-count-chart',
      dateRangeConfig: 'query-activity',
      showDeployments: true,
      areaChartProps: {
        readable: 'quantity',
        stack: true,
        showLegend: false,
        showXAxis: true,
        showCartesianGrid: true,
        colors: ['--chart-yellow'],
        breakdown: 'breakdown',
        breakdownLabel: 'query_kind',
        breakdownValue: 'count',
        yAxisTickFormatter: chartTickFormatters.count,
      },
    })
  })

  test('renders through createAreaChart without throwing', () => {
    expect(() =>
      createChartFromDeclarative(queryCountDeclarative)
    ).not.toThrow()
  })
})

describe('query-duration declarative', () => {
  test('loads without error', () => {
    expect(() => loadDeclarativeChart(queryDurationDeclarative)).not.toThrow()
  })

  test('config matches the hand-authored createAreaChart call', () => {
    const loaded = loadDeclarativeChart(queryDurationDeclarative)
    expect(loaded.kind).toBe('area')
    expect(loaded.config).toEqual({
      chartName: 'query-duration',
      index: 'event_time',
      categories: ['query_duration_s'],
      defaultTitle: 'Query Duration',
      defaultInterval: 'toStartOfDay',
      defaultLastHours: 24 * 14,
      dataTestId: 'query-duration-chart',
      dateRangeConfig: 'query-duration',
      areaChartProps: {
        colors: ['--chart-rose-200'],
        stack: true,
        showLegend: false,
        showXAxis: true,
        showCartesianGrid: true,
      },
    })
  })

  test('renders through createAreaChart without throwing', () => {
    expect(() =>
      createChartFromDeclarative(queryDurationDeclarative)
    ).not.toThrow()
  })
})
