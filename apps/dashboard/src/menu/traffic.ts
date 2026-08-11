import { ArrowDownToLineIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const trafficItems: MenuItem[] = [
  {
    title: 'Traffic',
    href: '/traffic',
    description:
      'Data flowing into the cluster: rows, bytes and insert queries over time',
    icon: ArrowDownToLineIcon,
    section: 'main',
    isNew: true,
    tableCheck: 'system.query_log',
    permission: { feature: 'metrics' },
  },
]
