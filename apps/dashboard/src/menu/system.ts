import { GearIcon, TableIcon, UpdateIcon } from '@radix-ui/react-icons'
import {
  AlertTriangleIcon,
  CircleDollarSignIcon,
  GaugeIcon,
  HardDriveIcon,
  SlidersHorizontalIcon,
  WorkflowIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const systemItems: MenuItem[] = [
  {
    title: 'System',
    href: '',
    icon: GearIcon,
    section: 'others',
    items: [
      {
        title: 'Settings',
        href: '/settings',
        description: 'Server configuration settings and current values',
        countKey: 'settings',
        countLabel: 'settings',
        icon: GearIcon,
        permission: { feature: 'settings' },
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/settings',
        tableCheck: 'system.settings',
      },
      {
        title: 'MergeTree Settings',
        href: '/mergetree-settings',
        description: 'MergeTree engine-specific settings',
        countKey: 'mergetree-settings',
        countLabel: 'settings',
        icon: TableIcon,
        permission: { feature: 'settings' },
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/merge_tree_settings',
        tableCheck: 'system.merge_tree_settings',
      },
      {
        title: 'Replicated MergeTree Settings',
        href: '/replicated-merge-tree-settings',
        description:
          'Replicated MergeTree engine settings and whether each was changed from default',
        icon: SlidersHorizontalIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/replicated_merge_tree_settings',
        tableCheck: 'system.replicated_merge_tree_settings',
      },
      {
        title: 'Disks',
        href: '/disks',
        description: 'Storage disk configuration and usage',
        countKey: 'disks',
        countLabel: 'disks',
        icon: HardDriveIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/disks',
        tableCheck: 'system.disks',
      },
      {
        title: 'Storage Economics',
        href: '/storage-economics',
        description:
          'Per-table compression ratios, storage cost, storage policies, and TTL move activity',
        icon: CircleDollarSignIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/parts',
        tableCheck: 'system.parts',
      },
      {
        title: 'Warnings',
        href: '/warnings',
        description:
          'Server-side warnings about potential configuration or operational issues',
        icon: AlertTriangleIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/warnings',
        tableCheck: 'system.warnings',
      },
      {
        title: 'Background Schedule Pool',
        href: '/background-schedule-pool',
        description:
          'Live background scheduled tasks and execution history (CH 25.12+)',
        icon: UpdateIcon,
        isNew: true,
        tableCheck: 'system.background_schedule_pool',
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/background_schedule_pool',
      },
      {
        title: 'Histogram Metrics',
        href: '/histogram-metrics',
        description:
          'Latency distribution panels for Keeper stages and query durations (system.histogram_metrics, CH 25.1+)',
        icon: GaugeIcon,
        isNew: true,
        tableCheck: 'system.histogram_metrics',
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/histogram_metrics',
      },
      {
        title: 'Workload Scheduling',
        href: '/workload-scheduling',
        description:
          'SQL resource scheduling workload hierarchy and live scheduler state: weights, priorities, and concurrency caps (CH 25.4+)',
        icon: WorkflowIcon,
        isNew: true,
        tableCheck: 'system.workloads',
        docs: 'https://clickhouse.com/docs/en/operations/workload-scheduling',
      },
    ],
  },
]
