import { GitCompareArrowsIcon, UnplugIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

import { PeerDBLogo } from '@/components/icons/peerdb-brand-logo'

export const peerdbItems: MenuItem[] = [
  {
    title: 'PeerDB',
    href: '',
    icon: PeerDBLogo,
    section: 'main',
    isNew: true,
    permission: { feature: 'peerdb' },
    items: [
      {
        title: 'Mirrors',
        href: '/peerdb',
        description:
          'PeerDB replication mirrors with status, throughput, and per-table sync',
        icon: GitCompareArrowsIcon,
        permission: { feature: 'peerdb' },
        docs: 'https://docs.peerdb.io/mirror/overview',
      },
      {
        title: 'Peers',
        href: '/peerdb/peers',
        description:
          'Source and destination peers, replication slot lag, and the mirror graph',
        icon: UnplugIcon,
        permission: { feature: 'peerdb' },
        docs: 'https://docs.peerdb.io/connect/overview',
      },
    ],
  },
]
