import {
  CounterClockwiseClockIcon,
  CrossCircledIcon,
  InfoCircledIcon,
  LightningBoltIcon,
  MixIcon,
} from '@radix-ui/react-icons'
import {
  ActivityIcon,
  CircleDollarSignIcon,
  CpuIcon,
  GaugeIcon,
  LayersIcon,
  UsersIcon,
  WandSparklesIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const queriesItems: MenuItem[] = [
  {
    title: 'Queries',
    href: '',
    countKey: 'running-queries',
    icon: MixIcon,
    section: 'main',
    permission: { feature: 'queries' },
    items: [
      {
        title: 'Running Queries',
        href: '/running-queries',
        description:
          'Real-time view of currently executing queries with progress tracking',
        countKey: 'running-queries',
        countLabel: 'running',
        icon: MixIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/processes',
        tableCheck: 'system.processes',
      },
      {
        title: 'History Queries',
        href: '/history-queries',
        description:
          'Historical query log with execution metrics, memory usage, and performance data',
        icon: CounterClockwiseClockIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_log',
        tableCheck: 'system.query_log',
      },
      {
        title: 'Query Insights',
        href: '/queries/insights',
        description:
          'QPS, latency percentiles, operations breakdown, rows read/returned, cache hit ratio, and errors over time',
        icon: ActivityIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_log',
        tableCheck: 'system.query_log',
      },
      {
        title: 'Recent Queries',
        href: '/recent-queries',
        description:
          'Reverse-chronological log of individual query executions — the per-query drill-down for Query Insights',
        icon: CounterClockwiseClockIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_log',
        tableCheck: 'system.query_log',
        isNew: true,
      },
      {
        title: 'Failed Queries',
        href: '/failed-queries',
        description:
          'Query execution failures with error details and stack traces',
        icon: CrossCircledIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_log',
        tableCheck: 'system.query_log',
      },
      {
        title: 'Most Expensive Queries',
        href: '/expensive-queries',
        description:
          'Resource-intensive queries ranked by CPU, memory, and duration',
        icon: CircleDollarSignIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_log',
        tableCheck: 'system.query_log',
      },
      {
        title: 'Slow Queries',
        href: '/slow-queries',
        description: 'Top 10 slowest finished queries by duration',
        icon: CounterClockwiseClockIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_log',
        tableCheck: 'system.query_log',
      },
      {
        title: 'Slow Query Patterns',
        href: '/slow-query-patterns',
        description:
          'Normalized query patterns aggregated by hash — calls, duration percentiles, and resource usage per pattern',
        icon: LayersIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_log',
        tableCheck: 'system.query_log',
      },
      {
        title: 'Explain',
        href: '/explain',
        description: 'Query execution plan analysis for performance tuning',
        icon: InfoCircledIcon,
        docs: 'https://clickhouse.com/docs/en/sql-reference/statements/explain',
      },
      {
        title: 'Advisor',
        href: '/advisor',
        description:
          'Ranked skip-index, projection, partition-key, and PREWHERE recommendations for a slow query (recommend-only)',
        icon: WandSparklesIcon,
        isNew: true,
      },
      {
        title: 'Query Views Log',
        href: '/query-views-log',
        description:
          'Materialized view execution history with status, duration, and row throughput',
        icon: CounterClockwiseClockIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_views_log',
        tableCheck: 'system.query_views_log',
      },
      {
        title: 'Thread & Parallelization',
        href: '/queries/thread-analysis',
        description:
          'Thread-level performance breakdown and parallel execution analysis',
        icon: CpuIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_thread_log',
        tableCheck: 'system.query_thread_log',
      },
      {
        title: 'User Processes',
        href: '/user-processes',
        description: 'Per-user memory usage and resource summary',
        icon: UsersIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/user_processes',
        tableCheck: 'system.user_processes',
      },
      {
        title: 'Query Metric Log',
        href: '/query-metric-log',
        description:
          'Per-query resource timeline: memory, CPU, and rows sampled over each query lifetime',
        icon: GaugeIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_metric_log',
        tableCheck: 'system.query_metric_log',
      },
      {
        title: 'Query Cache',
        href: '/query-cache',
        description:
          'Cached query results: cache entries, result sizes, and staleness',
        icon: LightningBoltIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_cache',
        tableCheck: 'system.query_cache',
      },
      {
        title: 'Query Condition Cache',
        href: '/query-condition-cache',
        description:
          'Cached WHERE-clause conditions for repeated query optimization (ClickHouse 25.3+)',
        icon: LightningBoltIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/query_condition_cache',
        tableCheck: 'system.query_condition_cache',
      },
    ],
  },
]
