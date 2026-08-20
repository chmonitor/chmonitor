import {
  CopyIcon,
  ExclamationTriangleIcon,
  ShuffleIcon,
  TableIcon,
  UpdateIcon,
} from '@radix-ui/react-icons'
import {
  BookOpenIcon,
  DownloadIcon,
  Grid2x2CheckIcon,
  LayersIcon,
  RssIcon,
  Trash2Icon,
  UnplugIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

import { dataExplorerItem } from './data-explorer'

export const tablesItems: MenuItem[] = [
  {
    title: 'Tables',
    href: '/tables',
    icon: TableIcon,
    section: 'main',
    permission: { feature: 'tables' },
    items: [
      dataExplorerItem,
      {
        title: 'Tables Overview',
        href: '/tables-overview',
        countKey: 'tables-overview',
        countLabel: 'tables',
        description: 'Table storage statistics with part counts and sizes',
        icon: Grid2x2CheckIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/parts',
        tableCheck: 'system.parts',
      },
      {
        title: 'DDL Queue',
        href: '/distributed-ddl-queue',
        countKey: 'distributed-ddl-queue',
        countLabel: 'pending',
        description: 'Cluster-wide DDL task queue status and execution history',
        icon: ShuffleIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/distributed_ddl_queue',
        tableCheck: 'system.distributed_ddl_queue',
      },
      {
        title: 'Table Replicas',
        href: '/replicas',
        description: 'Replicated table health status and lag metrics',
        countKey: 'table-replicas',
        countLabel: 'replicas',
        icon: CopyIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/replicas',
        tableCheck: 'system.replicas',
      },
      {
        title: 'Replication Queue',
        href: '/replication-queue',
        description:
          'Pending and in-progress replication tasks from Keeper/ZooKeeper',
        countKey: 'replication-queue',
        countLabel: 'pending',
        icon: ShuffleIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/replication_queue',
        tableCheck: 'system.replication_queue',
      },
      {
        title: 'Replicated Fetches',
        href: '/replicated-fetches',
        description:
          'Currently executing background part downloads from replica sources',
        icon: DownloadIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/replicated_fetches',
        tableCheck: 'system.replicated_fetches',
      },
      {
        title: 'Readonly Tables',
        href: '/readonly-tables',
        description: 'Tables in read-only mode with replica status',
        countKey: 'readonly-tables',
        countLabel: 'readonly',
        countVariant: 'destructive',
        icon: ExclamationTriangleIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/replicas',
        tableCheck: 'system.replicas',
      },
      {
        title: 'Dropped Tables',
        href: '/dropped-tables',
        description:
          'Tables awaiting final asynchronous drop (Atomic database engine)',
        icon: Trash2Icon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/dropped_tables',
        tableCheck: 'system.dropped_tables',
      },
      {
        title: 'Dictionaries',
        href: '/dictionaries',
        description: 'External dictionary status and memory usage',
        countKey: 'dictionaries',
        countLabel: 'dictionaries',
        icon: BookOpenIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/dictionaries',
        tableCheck: 'system.dictionaries',
      },
      {
        title: 'Kafka Consumers',
        href: '/kafka-consumers',
        description:
          'Kafka table engine consumer lag, poll/commit activity, and ingestion errors',
        icon: RssIcon,
        tableCheck: 'system.kafka_consumers',
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/kafka',
      },
      {
        title: 'RabbitMQ Consumers',
        href: '/rabbitmq-consumers',
        description:
          'RabbitMQ table engine consumer state: active consumers, messages received, and errors',
        icon: RssIcon,
        tableCheck: 'system.rabbitmq_consumers',
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/engines/table-engines/integrations/rabbitmq',
      },
      {
        title: 'Async Inserts',
        href: '/asynchronous-inserts',
        description:
          'Live async-insert queue and flush history: bytes queued, latency, and flush errors per table',
        icon: LayersIcon,
        tableCheck: 'system.asynchronous_inserts',
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/asynchronous_inserts',
      },
      {
        title: 'Detached Parts',
        href: '/detached-parts',
        description:
          'Parts detached from tables, awaiting attach, drop, or inspection',
        icon: UnplugIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/detached_parts',
        tableCheck: 'system.detached_parts',
      },
      {
        title: 'View Refreshes',
        href: '/view-refreshes',
        description:
          'Refreshable materialized view schedules, status, and last-refresh results',
        icon: UpdateIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/view_refreshes',
        tableCheck: 'system.view_refreshes',
      },
      {
        title: 'Index & Projection Analytics',
        href: '/index-analytics',
        description:
          'Data-skipping index and projection inventory with storage cost; flags dead indexes and empty projections',
        icon: LayersIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/data_skipping_indices',
        tableCheck: 'system.data_skipping_indices',
      },
    ],
  },
]
