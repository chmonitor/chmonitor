import {
  ArrowDownToLineIcon,
  CalendarClockIcon,
  SlidersHorizontalIcon,
  TrendingUpIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const insightsItems: MenuItem[] = [
  {
    // Parent groups the insights findings view, traffic, and the settings
    // pages — all sharing the same `insights` feature gate (set on the parent
    // so the whole group is filtered together).
    title: 'Insights',
    href: '',
    icon: TrendingUpIcon,
    section: 'main',
    isNew: true,
    permission: { feature: 'insights' },
    items: [
      {
        title: 'Insights',
        href: '/insights',
        description:
          'AI-generated findings, record breakers, and query insights for this cluster',
        icon: TrendingUpIcon,
        isNew: true,
      },
      {
        title: 'Traffic',
        href: '/traffic',
        description:
          'Data flowing into the cluster: rows, bytes and insert queries over time',
        icon: ArrowDownToLineIcon,
        isNew: true,
        tableCheck: 'system.query_log',
      },
      {
        title: 'Insights Settings',
        href: '/insights-settings',
        description:
          'Configure how insights are generated — templates, AI enhancement, model, and prompt style',
        icon: SlidersHorizontalIcon,
        isNew: true,
      },
      {
        title: 'Scheduled Reports',
        href: '/report-settings',
        description:
          'Weekly or monthly cluster health reports, delivered to your alert channels',
        icon: CalendarClockIcon,
        isNew: true,
        // Subscriptions persist in the metadata DB (report-subscription-store);
        // dimmed when the deployment has no D1/Postgres configured.
        requiresMetadataDb: true,
      },
    ],
  },
]
