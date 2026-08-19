import type { ColumnRow, SchemaDiffResponse, TableRow } from './types'

import { assembleCatalog } from './catalog'
import { compareCatalogs } from './compare'
import { buildChangePlan } from './plan'
import { EXAMPLE_PEERS } from '@/lib/compare/example-peers'

const SOURCE_TABLES: TableRow[] = [
  {
    database: 'analytics',
    table: 'events',
    engine: 'MergeTree',
    sorting_key: 'event_date, user_id',
    partition_key: 'toYYYYMM(event_date)',
    primary_key: 'event_date, user_id',
    create_table_query:
      'CREATE TABLE analytics.events (`event_date` Date, `user_id` UInt64, `event_type` LowCardinality(String), `payload` String CODEC(ZSTD(1))) ENGINE = MergeTree PARTITION BY toYYYYMM(event_date) ORDER BY (event_date, user_id)',
  },
  {
    database: 'analytics',
    table: 'sessions',
    engine: 'MergeTree',
    sorting_key: 'session_id',
    partition_key: '',
    primary_key: 'session_id',
    create_table_query:
      'CREATE TABLE analytics.sessions (`session_id` UUID, `user_id` UInt64, `started_at` DateTime) ENGINE = MergeTree ORDER BY session_id',
  },
  {
    database: 'analytics',
    table: 'users',
    engine: 'MergeTree',
    sorting_key: 'id',
    partition_key: '',
    primary_key: 'id',
    create_table_query:
      'CREATE TABLE analytics.users (`id` UInt64, `email` String) ENGINE = MergeTree ORDER BY id',
  },
]

const TARGET_TABLES: TableRow[] = [
  {
    database: 'analytics',
    table: 'events',
    engine: 'MergeTree',
    sorting_key: 'event_date, user_id',
    partition_key: 'toYYYYMM(event_date)',
    primary_key: 'event_date, user_id',
    create_table_query:
      'CREATE TABLE analytics.events (`event_date` Date, `user_id` UInt64, `event_type` LowCardinality(String)) ENGINE = MergeTree PARTITION BY toYYYYMM(event_date) ORDER BY (event_date, user_id)',
  },
  {
    database: 'billing',
    table: 'invoices',
    engine: 'MergeTree',
    sorting_key: 'invoice_id',
    partition_key: '',
    primary_key: 'invoice_id',
    create_table_query:
      'CREATE TABLE billing.invoices (`invoice_id` UInt64, `amount` Decimal(18, 2)) ENGINE = MergeTree ORDER BY invoice_id',
  },
  {
    database: 'analytics',
    table: 'users',
    engine: 'MergeTree',
    sorting_key: 'id',
    partition_key: '',
    primary_key: 'id',
    create_table_query:
      'CREATE TABLE analytics.users (`id` UInt64, `email` String) ENGINE = MergeTree ORDER BY id',
  },
]

const SOURCE_COLUMNS: ColumnRow[] = [
  {
    database: 'analytics',
    table: 'events',
    name: 'event_date',
    type: 'Date',
    codec: '',
  },
  {
    database: 'analytics',
    table: 'events',
    name: 'user_id',
    type: 'UInt64',
    codec: '',
  },
  {
    database: 'analytics',
    table: 'events',
    name: 'event_type',
    type: 'LowCardinality(String)',
    codec: '',
  },
  {
    database: 'analytics',
    table: 'events',
    name: 'payload',
    type: 'String',
    codec: 'CODEC(ZSTD(1))',
  },
  {
    database: 'analytics',
    table: 'sessions',
    name: 'session_id',
    type: 'UUID',
    codec: '',
  },
  {
    database: 'analytics',
    table: 'sessions',
    name: 'user_id',
    type: 'UInt64',
    codec: '',
  },
  {
    database: 'analytics',
    table: 'sessions',
    name: 'started_at',
    type: 'DateTime',
    codec: '',
  },
  {
    database: 'analytics',
    table: 'users',
    name: 'id',
    type: 'UInt64',
    codec: '',
  },
  {
    database: 'analytics',
    table: 'users',
    name: 'email',
    type: 'String',
    codec: '',
  },
]

const TARGET_COLUMNS: ColumnRow[] = [
  {
    database: 'analytics',
    table: 'events',
    name: 'event_date',
    type: 'Date',
    codec: '',
  },
  {
    database: 'analytics',
    table: 'events',
    name: 'user_id',
    type: 'UInt64',
    codec: '',
  },
  {
    database: 'analytics',
    table: 'events',
    name: 'event_type',
    type: 'LowCardinality(String)',
    codec: '',
  },
  {
    database: 'billing',
    table: 'invoices',
    name: 'invoice_id',
    type: 'UInt64',
    codec: '',
  },
  {
    database: 'billing',
    table: 'invoices',
    name: 'amount',
    type: 'Decimal(18, 2)',
    codec: '',
  },
  {
    database: 'analytics',
    table: 'users',
    name: 'id',
    type: 'UInt64',
    codec: '',
  },
  {
    database: 'analytics',
    table: 'users',
    name: 'email',
    type: 'String',
    codec: '',
  },
]

/** Deterministic sample schema diff for the one-host example preview. */
export function buildExampleSchemaDiff(): SchemaDiffResponse {
  const sourceCatalog = assembleCatalog(SOURCE_TABLES, SOURCE_COLUMNS)
  const targetCatalog = assembleCatalog(TARGET_TABLES, TARGET_COLUMNS)
  const diff = compareCatalogs(sourceCatalog, targetCatalog)
  const plan = buildChangePlan(diff)
  return {
    success: true,
    hosts: EXAMPLE_PEERS,
    nodes: [],
    scope: 'hosts',
    sourceHostId: EXAMPLE_PEERS[0].id,
    targetHostId: EXAMPLE_PEERS[1].id,
    diff,
    plan,
  }
}
