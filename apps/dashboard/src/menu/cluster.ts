import { Grid2x2CheckIcon, UngroupIcon, UnplugIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const clusterItems: MenuItem[] = [
  {
    title: 'Cluster',
    href: '',
    icon: UngroupIcon,
    section: 'others',
    permission: { feature: 'cluster' },
    items: [
      {
        title: 'Clusters',
        href: '/clusters',
        description: 'Interactive topology map and cluster member information',
        countKey: 'clusters',
        countLabel: 'clusters',
        icon: UngroupIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/clusters',
        tableCheck: 'system.clusters',
      },
      {
        title: 'Fleet Overview',
        href: '/fleet',
        description: 'Health signals across all ClickHouse hosts in one view',
        icon: Grid2x2CheckIcon,
        isNew: true,
      },
      {
        title: 'Connections',
        href: '/charts?name=connections-http,connections-interserver',
        description: 'Client and inter-server connection metrics',
        icon: UnplugIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/metrics',
        tableCheck: 'system.metrics',
      },
    ],
  },
]
