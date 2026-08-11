import { CircleDollarSignIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const billingItems: MenuItem[] = [
  {
    // Cloud (SaaS) plan + host limits. Self-hosting is free forever, so this
    // only makes sense in the cloud product — `cloudOnly` hides it in OSS
    // across every nav surface (see getVisibleMenuItems).
    title: 'Billing',
    href: '/billing',
    icon: CircleDollarSignIcon,
    section: 'footer',
    permission: { feature: 'billing' },
    cloudOnly: true,
    // Account-level page — engine-independent, so keep it visible while a
    // Postgres source is selected (absent `engines` means ClickHouse family).
    engines: ['clickhouse', 'clickhouse-cloud', 'postgres'],
  },
]
