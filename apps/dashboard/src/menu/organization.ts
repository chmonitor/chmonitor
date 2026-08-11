import { UsersIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const organizationItems: MenuItem[] = [
  {
    // Cloud (SaaS) team management — members, roles, invitations. Cloud-only
    // (an org is created on a paid upgrade); `cloudOnly` hides it in OSS.
    title: 'Organization',
    href: '/organization',
    icon: UsersIcon,
    section: 'footer',
    permission: { feature: 'billing' },
    cloudOnly: true,
    engines: ['clickhouse', 'clickhouse-cloud', 'postgres'],
  },
]
