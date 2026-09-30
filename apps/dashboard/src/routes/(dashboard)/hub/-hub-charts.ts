/**
 * Key charts per hub page. Every chart is an existing registry chart (no new
 * SQL); `href` is the detail page its title links to and must be a page of the
 * same group (asserted in lib/menu/__tests__/hub.test.ts).
 */

import type { HubChartConfig } from '@/components/hub/hub-page'

import {
  ChartCPUUsage,
  ChartCrashFrequency,
  ChartDiskSize,
  ChartErrorRateOverTime,
  ChartFailedQueryCount,
  ChartKeeperException,
  ChartMemoryUsage,
  ChartMergeCount,
  ChartQueryCount,
  ChartQueryDuration,
  ChartReadonlyReplica,
  ChartReplicationQueueCount,
  ChartSummaryUsedByRunningQueries,
  ChartTopTableSize,
  ChartZookeeperRequests,
} from '../-charts-lazy'

export const HUB_CHARTS: Record<string, HubChartConfig[]> = {
  '/hub/queries': [
    {
      id: 'running-queries',
      component: ChartSummaryUsedByRunningQueries,
      title: 'Running Queries',
      href: '/running-queries',
    },
    {
      id: 'query-count',
      component: ChartQueryCount,
      title: 'Queries (24h)',
      lastHours: 24,
      interval: 'toStartOfHour',
      href: '/history-queries',
    },
    {
      id: 'failed-queries',
      component: ChartFailedQueryCount,
      title: 'Failed Queries (24h)',
      lastHours: 24,
      interval: 'toStartOfHour',
      href: '/failed-queries',
    },
    {
      id: 'query-duration',
      component: ChartQueryDuration,
      title: 'Avg Query Duration (24h)',
      lastHours: 24,
      interval: 'toStartOfHour',
      href: '/slow-queries',
    },
  ],
  '/hub/data-storage': [
    {
      id: 'disk-size',
      component: ChartDiskSize,
      title: 'Disk Size',
      href: '/disks',
    },
    {
      id: 'top-table-size',
      component: ChartTopTableSize,
      title: 'Top Tables by Size',
      href: '/tables-overview',
    },
    {
      id: 'merge-count',
      component: ChartMergeCount,
      title: 'Merges and Mutations (24h)',
      lastHours: 24,
      interval: 'toStartOfHour',
      href: '/merges',
    },
  ],
  '/hub/cluster-replication': [
    {
      id: 'replication-queue',
      component: ChartReplicationQueueCount,
      title: 'Replication Queue',
      href: '/replication-queue',
    },
    {
      id: 'readonly-replicas',
      component: ChartReadonlyReplica,
      title: 'Readonly Replicas (24h)',
      lastHours: 24,
      interval: 'toStartOfFifteenMinutes',
      href: '/replicas',
    },
    {
      id: 'keeper-requests',
      component: ChartZookeeperRequests,
      title: 'Keeper Requests (7d)',
      lastHours: 24 * 7,
      interval: 'toStartOfHour',
      href: '/keeper/overview',
    },
    {
      id: 'keeper-exceptions',
      component: ChartKeeperException,
      title: 'Keeper Exceptions',
      href: '/keeper/log',
    },
  ],
  '/hub/server': [
    {
      id: 'cpu-usage',
      component: ChartCPUUsage,
      title: 'CPU Usage (24h)',
      lastHours: 24,
      interval: 'toStartOfTenMinutes',
      href: '/metrics',
    },
    {
      id: 'memory-usage',
      component: ChartMemoryUsage,
      title: 'Memory Usage (24h)',
      lastHours: 24,
      interval: 'toStartOfTenMinutes',
      href: '/asynchronous-metrics',
    },
    {
      id: 'error-rate',
      component: ChartErrorRateOverTime,
      title: 'Error Rate (24h)',
      lastHours: 24,
      interval: 'toStartOfHour',
      href: '/logs/text-log',
    },
    {
      id: 'crash-frequency',
      component: ChartCrashFrequency,
      title: 'Crashes (30d)',
      lastHours: 24 * 30,
      interval: 'toStartOfDay',
      href: '/logs/crashes',
    },
  ],
}
