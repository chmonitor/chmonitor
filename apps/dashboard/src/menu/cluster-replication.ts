import {
  CopyIcon,
  CounterClockwiseClockIcon,
  InfoCircledIcon,
  ShuffleIcon,
} from '@radix-ui/react-icons'
import {
  DownloadIcon,
  EyeIcon,
  Grid2x2CheckIcon,
  HeartPulseIcon,
  LayersIcon,
  RollerCoasterIcon,
  ScrollTextIcon,
  UngroupIcon,
  UnplugIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const clusterReplicationItems: MenuItem[] = [
  {
    // Topology → replication → coordination (Keeper). No `permission` on the
    // parent: cluster pages keep `cluster`, replication pages keep `tables`,
    // and Keeper pages were never gated — each child carries its own.
    title: 'Cluster & Replication',
    href: '',
    hubHref: '/hub/cluster-replication',
    icon: UngroupIcon,
    section: 'main',
    items: [
      // Cluster
      {
        subgroup: 'Cluster',
        title: 'Clusters',
        href: '/clusters',
        description: 'Interactive topology map and cluster member information',
        countKey: 'clusters',
        countLabel: 'clusters',
        icon: UngroupIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/clusters',
        tableCheck: 'system.clusters',
        permission: { feature: 'cluster' },
      },
      {
        subgroup: 'Cluster',
        title: 'Fleet Overview',
        href: '/fleet',
        description: 'Health signals across all ClickHouse hosts in one view',
        icon: Grid2x2CheckIcon,
        isNew: true,
        permission: { feature: 'cluster' },
      },
      {
        subgroup: 'Cluster',
        title: 'Connections',
        href: '/charts?name=connections-http,connections-interserver',
        description: 'Client and inter-server connection metrics',
        icon: UnplugIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/metrics',
        tableCheck: 'system.metrics',
        permission: { feature: 'cluster' },
      },
      // Replication
      {
        subgroup: 'Replication',
        title: 'Table Replicas',
        href: '/replicas',
        description: 'Replicated table health status and lag metrics',
        countKey: 'table-replicas',
        countLabel: 'replicas',
        icon: CopyIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/replicas',
        tableCheck: 'system.replicas',
        permission: { feature: 'tables' },
      },
      {
        subgroup: 'Replication',
        title: 'Replication Queue',
        href: '/replication-queue',
        description:
          'Pending and in-progress replication tasks from Keeper/ZooKeeper',
        countKey: 'replication-queue',
        countLabel: 'pending',
        icon: ShuffleIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/replication_queue',
        tableCheck: 'system.replication_queue',
        permission: { feature: 'tables' },
      },
      {
        subgroup: 'Replication',
        title: 'Replicated Fetches',
        href: '/replicated-fetches',
        description:
          'Currently executing background part downloads from replica sources',
        icon: DownloadIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/replicated_fetches',
        tableCheck: 'system.replicated_fetches',
        permission: { feature: 'tables' },
      },
      {
        subgroup: 'Replication',
        title: 'DDL Queue',
        href: '/distributed-ddl-queue',
        countKey: 'distributed-ddl-queue',
        countLabel: 'pending',
        description: 'Cluster-wide DDL task queue status and execution history',
        icon: ShuffleIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/distributed_ddl_queue',
        tableCheck: 'system.distributed_ddl_queue',
        permission: { feature: 'tables' },
      },
      // Keeper
      {
        subgroup: 'Keeper',
        title: 'Overview',
        href: '/keeper/overview',
        description:
          'Keeper health at a glance: liveness, request load, latency, and per-node cluster state',
        icon: HeartPulseIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_info',
        tableCheck: 'system.zookeeper_info',
      },
      {
        subgroup: 'Keeper',
        title: 'Data Browser',
        href: '/keeper?path=/',
        description:
          'Browse the ZooKeeper/Keeper znode tree for distributed coordination',
        icon: RollerCoasterIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper',
        tableCheck: 'system.zookeeper',
      },
      {
        subgroup: 'Keeper',
        title: 'Keeper Info',
        href: '/keeper/info',
        description:
          'Cluster-health introspection of every Keeper node: role, latency, raft log, znode counts',
        icon: InfoCircledIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_info',
        tableCheck: 'system.zookeeper_info',
      },
      {
        subgroup: 'Keeper',
        // Renamed from "Connections": it now shares a list with the cluster
        // Connections page above.
        title: 'Keeper Connections',
        href: '/keeper/connections',
        description:
          'Live connections from this ClickHouse server to Keeper/ZooKeeper',
        icon: UnplugIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_connection',
        tableCheck: 'system.zookeeper_connection',
      },
      {
        subgroup: 'Keeper',
        title: 'Connection Log',
        href: '/keeper/connection-log',
        description:
          'History of Keeper/ZooKeeper connect and disconnect events with reasons',
        icon: CounterClockwiseClockIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_connection_log',
        tableCheck: 'system.zookeeper_connection_log',
      },
      {
        subgroup: 'Keeper',
        title: 'Request Log',
        href: '/keeper/log',
        description:
          'Per-request log of Keeper/ZooKeeper operations and responses (requires <zookeeper_log>)',
        icon: ScrollTextIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_log',
        tableCheck: 'system.zookeeper_log',
      },
      {
        subgroup: 'Keeper',
        title: 'Watches',
        href: '/keeper/watches',
        description:
          'Currently active ZooKeeper/Keeper watches registered by this server',
        icon: EyeIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_watches',
        tableCheck: 'system.zookeeper_watches',
      },
      {
        subgroup: 'Keeper',
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
