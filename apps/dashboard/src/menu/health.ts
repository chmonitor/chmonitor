import {
  BellRingIcon,
  HeartPulseIcon,
  SlidersHorizontalIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const healthItems: MenuItem[] = [
  {
    // Parent groups the health summary and the dedicated settings pages.
    // /health?settings=alerts redirects to /alert-settings for old links.
    title: 'Health',
    href: '',
    icon: HeartPulseIcon,
    section: 'main',
    permission: { feature: 'health' },
    items: [
      {
        title: 'Health',
        href: '/health',
        description:
          'Real-time health indicators for your ClickHouse cluster with active alerts',
        icon: HeartPulseIcon,
      },
      {
        title: 'Health Settings',
        href: '/health-settings',
        description:
          'Per-check warning and critical thresholds for health monitoring',
        icon: SlidersHorizontalIcon,
        isNew: true,
      },
      {
        title: 'Alert Settings',
        href: '/alert-settings',
        description:
          'Alert channels, webhooks, routing, quiet hours, digests and alert history',
        icon: BellRingIcon,
        isNew: true,
      },
    ],
  },
]
