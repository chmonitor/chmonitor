/**
 * Parity test for the zookeeper/ domain declarative chart catalog
 * (plans/58-declarative-chart-schema.md). See
 * ../query/query-catalog.test.ts for the parity-testing philosophy this
 * mirrors. This is the catalog's `type: 'bar'` (createBarChart) coverage.
 */

import { createChartFromDeclarative, loadDeclarativeChart } from '../../loader'
import { zookeeperRequestsDeclarative } from './zookeeper-requests'
import { describe, expect, test } from 'bun:test'
import { chartTickFormatters } from '@/lib/utils'

describe('zookeeper-requests declarative', () => {
  test('loads without error', () => {
    expect(() =>
      loadDeclarativeChart(zookeeperRequestsDeclarative)
    ).not.toThrow()
  })

  test('config matches the hand-authored createBarChart call', () => {
    const loaded = loadDeclarativeChart(zookeeperRequestsDeclarative)
    expect(loaded.kind).toBe('bar')
    expect(loaded.config).toEqual({
      chartName: 'zookeeper-requests',
      index: 'event_time',
      categories: ['ZookeeperRequests', 'ZooKeeperWatch'],
      defaultTitle: 'ZooKeeper Requests',
      defaultInterval: 'toStartOfHour',
      defaultLastHours: 24 * 7,
      dataTestId: 'zookeeper-requests-chart',
      dateRangeConfig: 'health',
      xAxisDateFormat: true,
      barChartProps: {
        showLegend: true,
        stack: true,
        yAxisTickFormatter: chartTickFormatters.count,
      },
    })
  })

  test('renders through createBarChart without throwing', () => {
    expect(() =>
      createChartFromDeclarative(zookeeperRequestsDeclarative)
    ).not.toThrow()
  })
})
