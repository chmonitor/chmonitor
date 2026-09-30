import {
  ArchiveIcon,
  ExclamationTriangleIcon,
  LightningBoltIcon,
  TableIcon,
  UpdateIcon,
} from '@radix-ui/react-icons'
import {
  BookOpenIcon,
  CalendarClockIcon,
  CircleDollarSignIcon,
  CloudIcon,
  CombineIcon,
  DatabaseIcon,
  GitCompareArrowsIcon,
  Grid2x2CheckIcon,
  HardDriveIcon,
  LayersIcon,
  MoveIcon,
  RssIcon,
  Trash2Icon,
  UnplugIcon,
} from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const dataStorageItems: MenuItem[] = [
  {
    // Everything about the data itself: tables, part lifecycle, table health,
    // ingestion, and where bytes live. Children are ordered by those runs.
    //
    // No `permission` on the parent: children came from groups with different
    // gates (`tables`, `operations`, `peerdb`, none), so each child carries
    // the gate it used to inherit. A parent gate would over-gate the group.
    title: 'Data & Storage',
    href: '',
    icon: DatabaseIcon,
    section: 'main',
    items: [
      // Tables
      {
        title: 'Tables',
        href: '/tables',
        description: 'Browse tables by database with columns and sizes',
        icon: TableIcon,
        permission: { feature: 'tables' },
      },
      {
        title: 'Tables Overview',
        href: '/tables-overview',
        countKey: 'tables-overview',
        countLabel: 'tables',
        description: 'Table storage statistics with part counts and sizes',
        icon: Grid2x2CheckIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/parts',
        tableCheck: 'system.parts',
        permission: { feature: 'tables' },
      },
      {
        title: 'Data Explorer',
        href: '/explorer',
        description: 'Interactive database schema browser with metadata',
        countKey: 'tables-explorer',
        countLabel: 'tables',
        icon: TableIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/databases', // pragma: allowlist secret
        tableCheck: ['system.databases', 'system.tables'],
        permission: { feature: 'tables' },
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
        permission: { feature: 'tables' },
      },
      // Merges & parts
      {
        title: 'Merges',
        href: '/merges',
        description: 'Active merge and mutation operations with progress',
        countKey: 'merges',
        countLabel: 'active',
        icon: CombineIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/merges',
        tableCheck: 'system.merges',
        permission: { feature: 'operations' },
      },
      {
        title: 'Merge Performance',
        href: '/merge-performance',
        description: 'Historical merge operation statistics and trends',
        icon: LightningBoltIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/part_log',
        tableCheck: 'system.part_log',
        permission: { feature: 'operations' },
      },
      {
        title: 'Mutations',
        href: '/mutations',
        description: 'Table mutation status with progress and failures',
        icon: UpdateIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/mutations',
        tableCheck: 'system.mutations',
        permission: { feature: 'operations' },
      },
      {
        title: 'Moves',
        href: '/moves',
        description:
          'In-progress part moves between disks and volumes (TTL / storage policy)',
        icon: MoveIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/moves',
        tableCheck: 'system.moves',
        permission: { feature: 'operations' },
      },
      {
        title: 'Part Log',
        href: '/part-log',
        description:
          'Part lifecycle timeline: creations, merges, mutations, downloads, and removals',
        icon: LayersIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/part_log',
        tableCheck: 'system.part_log',
        permission: { feature: 'operations' },
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
        permission: { feature: 'tables' },
      },
      // Table health
      {
        title: 'TTL & Partitions',
        href: '/ttl-partition-health',
        description:
          'TTL expression, PARTITION BY, partition counts, and recommend-only next steps per table',
        icon: CalendarClockIcon,
        isNew: true,
        keywords: [
          'ttl-partition-health',
          'partition health',
          'partition by',
          'expire',
          'merge tree ttl',
          'ttl inventory',
        ],
        docs: 'https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree#table_engine-mergetree-ttl', // pragma: allowlist secret
        tableCheck: 'system.parts',
        permission: { feature: 'tables' },
      },
      {
        title: 'Dropped Tables',
        href: '/dropped-tables',
        description:
          'Tables awaiting final asynchronous drop (Atomic database engine)',
        icon: Trash2Icon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/dropped_tables',
        tableCheck: 'system.dropped_tables',
        permission: { feature: 'tables' },
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
        permission: { feature: 'tables' },
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
        permission: { feature: 'tables' },
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
        permission: { feature: 'tables' },
      },
      // Ingestion
      {
        title: 'Async Inserts',
        href: '/asynchronous-inserts',
        description:
          'Live async-insert queue and flush history: bytes queued, latency, and flush errors per table',
        icon: LayersIcon,
        tableCheck: 'system.asynchronous_inserts',
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/asynchronous_inserts',
        permission: { feature: 'tables' },
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
        permission: { feature: 'tables' },
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
        permission: { feature: 'tables' },
      },
      {
        // "PeerDB" prefix: the old PeerDB group heading is gone, so the bare
        // "Mirrors" / "Peers" labels would lose their context.
        title: 'PeerDB Mirrors',
        href: '/peerdb',
        description:
          'PeerDB replication mirrors with status, throughput, and per-table sync',
        icon: GitCompareArrowsIcon,
        permission: { feature: 'peerdb' },
        docs: 'https://docs.peerdb.io/mirror/overview',
      },
      {
        title: 'PeerDB Peers',
        href: '/peerdb/peers',
        description:
          'Source and destination peers, replication slot lag, and the mirror graph',
        icon: UnplugIcon,
        permission: { feature: 'peerdb' },
        docs: 'https://docs.peerdb.io/connect/overview',
      },
      // Storage
      {
        title: 'Disks',
        href: '/disks',
        description: 'Storage disk configuration and usage',
        countKey: 'disks',
        countLabel: 'disks',
        icon: HardDriveIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/disks',
        tableCheck: 'system.disks',
      },
      {
        title: 'Storage Economics',
        href: '/storage-economics',
        description:
          'Per-table compression ratios, storage cost, storage policies, and TTL move activity',
        icon: CircleDollarSignIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/parts',
        tableCheck: 'system.parts',
      },
      {
        title: 'Blob Storage Log',
        href: '/blob-storage-log',
        description:
          'Object storage I/O operations (reads, writes, deletes) on S3/blob disks',
        icon: CloudIcon,
        isNew: true,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/blob_storage_log',
        tableCheck: 'system.blob_storage_log',
        permission: { feature: 'operations' },
      },
      {
        title: 'Backups',
        href: '/backups',
        description: 'Backup operation history with status and sizes',
        countKey: 'backups',
        countLabel: 'backups',
        icon: ArchiveIcon,
        docs: 'https://clickhouse.com/docs/en/operations/system-tables/backup_log',
        tableCheck: 'system.backup_log',
        permission: { feature: 'operations' },
      },
    ],
  },
]
