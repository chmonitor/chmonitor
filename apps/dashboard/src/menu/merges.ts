import { LightningBoltIcon, UpdateIcon } from '@radix-ui/react-icons'
import { CombineIcon, LayersIcon, MoveIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const mergesItems: MenuItem[] = [
  {
    title: 'Merges',
    href: '/merges',
    countKey: 'merges',
    countLabel: 'active',
    icon: CombineIcon,
    section: 'main',
    permission: { feature: 'operations' },
    items: [
      {
        title: 'Merges',
        href: '/merges',
        description: 'Active merge and mutation operations with progress',
        countKey: 'merges',
        countLabel: 'active',
        icon: CombineIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/merges',
        tableCheck: 'system.merges',
      },
      {
        title: 'Merge Performance',
        href: '/merge-performance',
        description: 'Historical merge operation statistics and trends',
        icon: LightningBoltIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/part_log',
        tableCheck: 'system.part_log',
      },
      {
        title: 'Mutations',
        href: '/mutations',
        description: 'Table mutation status with progress and failures',
        icon: UpdateIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/mutations',
        tableCheck: 'system.mutations',
      },
      {
        title: 'Moves',
        href: '/moves',
        description:
          'In-progress part moves between disks and volumes (TTL / storage policy)',
        icon: MoveIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/moves',
        tableCheck: 'system.moves',
      },
      {
        title: 'Part Log',
        href: '/part-log',
        description:
          'Part lifecycle timeline: creations, merges, mutations, downloads, and removals',
        icon: LayersIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/part_log',
        tableCheck: 'system.part_log',
      },
    ],
  },
]
