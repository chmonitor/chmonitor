import {
  ArrowDownToLineIcon,
  BellRingIcon,
  HeartPulseIcon,
  RssIcon,
  TrendingUpIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const alertsInsightsItems: MenuItem[] = [
  {
    // "What needs attention": findings, health + alerts, inbound events,
    // and traffic. Their settings pages live in the Settings group. No
    // `permission` on the parent: children keep `insights` / `health`.
    title: 'Alerts & Insights',
    href: '',
    icon: BellRingIcon,
    section: 'main',
    items: [
      {
        title: 'Insights',
        href: '/insights',
        description:
          'AI-generated findings, record breakers, and query insights for this cluster',
        icon: TrendingUpIcon,
        isNew: true,
        permission: { feature: 'insights' },
      },
      {
        // Named "Health and Alert" to disambiguate from "Health Settings"
        // (Settings group). The page header already reads "Health Summary".
        title: 'Health and Alert',
        href: '/health',
        description:
          'Real-time health indicators for your ClickHouse cluster with active alerts',
        keywords: ['health summary', 'alerts', 'status', 'health checks'],
        icon: HeartPulseIcon,
        permission: { feature: 'health' },
      },
      {
        title: 'Inbound Events',
        href: '/inbound-events',
        description:
          'Alertmanager, Datadog, and generic webhook events ingested via POST /api/events/ingest',
        icon: RssIcon,
        isNew: true,
        permission: { feature: 'health' },
      },
      {
        title: 'Traffic',
        href: '/traffic',
        description:
          'Data flowing into the cluster: rows, bytes and insert queries over time',
        icon: ArrowDownToLineIcon,
        isNew: true,
        // `tableCheck` alone already makes this a hide-when-unavailable item
        // (#3463) — no `hideWhenUnavailable` needed. Asserted by
        // menu-config-invariants.test.ts so a future gate swap cannot silently
        // turn it into a dead greyed row.
        tableCheck: 'system.query_log',
        permission: { feature: 'insights' },
      },
    ],
  },
]
