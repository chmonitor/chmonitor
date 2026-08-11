import { HomeIcon } from '@radix-ui/react-icons'

import type { MenuItem } from '@/components/menu/types'

export const overviewItems: MenuItem[] = [
  {
    title: 'Overview',
    href: '/overview',
    icon: HomeIcon,
    section: 'main',
    permission: { feature: 'overview' },
  },
]
