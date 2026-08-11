import {
  CounterClockwiseClockIcon,
  InfoCircledIcon,
} from '@radix-ui/react-icons'
import {
  EyeIcon,
  HeartPulseIcon,
  LayersIcon,
  RollerCoasterIcon,
  ScrollTextIcon,
  UnplugIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const keeperItems: MenuItem[] = [
  {
    title: 'Keeper',
    href: '',
    icon: RollerCoasterIcon,
    section: 'main',
    isNew: true,
    items: [
      {
        title: 'Overview',
        href: '/keeper/overview',
        description:
          'Keeper health at a glance: liveness, request load, latency, and per-node cluster state',
        icon: HeartPulseIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_info',
        tableCheck: 'system.zookeeper_info',
      },
      {
        title: 'Data Browser',
        href: '/keeper?path=/',
        description:
          'Browse the ZooKeeper/Keeper znode tree for distributed coordination',
        icon: RollerCoasterIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper',
        tableCheck: 'system.zookeeper',
      },
      {
        title: 'Keeper Info',
        href: '/keeper/info',
        description:
          'Cluster-health introspection of every Keeper node: role, latency, raft log, znode counts',
        icon: InfoCircledIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_info',
        tableCheck: 'system.zookeeper_info',
      },
      {
        title: 'Connections',
        href: '/keeper/connections',
        description:
          'Live connections from this ClickHouse server to Keeper/ZooKeeper',
        icon: UnplugIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_connection',
        tableCheck: 'system.zookeeper_connection',
      },
      {
        title: 'Connection Log',
        href: '/keeper/connection-log',
        description:
          'History of Keeper/ZooKeeper connect and disconnect events with reasons',
        icon: CounterClockwiseClockIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_connection_log',
        tableCheck: 'system.zookeeper_connection_log',
      },
      {
        title: 'Request Log',
        href: '/keeper/log',
        description:
          'Per-request log of Keeper/ZooKeeper operations and responses (requires <zookeeper_log>)',
        icon: ScrollTextIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_log',
        tableCheck: 'system.zookeeper_log',
      },
      {
        title: 'Watches',
        href: '/keeper/watches',
        description:
          'Currently active ZooKeeper/Keeper watches registered by this server',
        icon: EyeIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_watches',
        tableCheck: 'system.zookeeper_watches',
      },
      {
        title: 'Keeper Deep-dive',
        href: '/keeper/deep-dive',
        description:
          'Keeper internals (CH 26.6+): Raft cluster membership, snapshot files, and changelog (WAL) disk footprint',
        icon: LayersIcon,
        isNew: true,
      },
    ],
  },
]
