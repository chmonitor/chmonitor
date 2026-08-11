import { BarChartIcon } from '@radix-ui/react-icons'
import { CpuIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const metricsItems: MenuItem[] = [
  {
    title: 'Metrics',
    href: '',
    icon: BarChartIcon,
    section: 'main',
    items: [
      {
        title: 'Metrics',
        href: '/metrics',
        description: 'Real-time server metrics and counters',
        countKey: 'metrics',
        countLabel: 'metrics',
        icon: BarChartIcon,
        permission: { feature: 'metrics' },
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/metrics',
        tableCheck: 'system.metrics',
      },
      {
        title: 'Async Metrics',
        href: '/asynchronous-metrics',
        description: 'Background-calculated metrics for resource monitoring',
        icon: BarChartIcon,
        permission: { feature: 'metrics' },
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/asynchronous_metrics',
        tableCheck: 'system.asynchronous_metrics',
      },
      {
        title: 'Profiler',
        href: '/profiler',
        description: 'CPU profiling data for query performance analysis',
        icon: CpuIcon,
        isNew: true,
        permission: { feature: 'metrics' },
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/processors_profile_log',
        tableCheck: 'system.processors_profile_log',
      },
    ],
  },
]
