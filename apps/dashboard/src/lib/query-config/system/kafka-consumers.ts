import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const kafkaConsumersConfig: QueryConfig = {
  name: 'kafka-consumers',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['consumer_id'] },
  description:
    'Kafka table engine consumer state: poll/commit activity, messages read, and last exception per consumer',
  refreshInterval: 15_000,
  optional: true,
  tableCheck: 'system.kafka_consumers',
  // CH 25.12 adds dependencies / missing_dependencies to detect broken Kafka→MV pipelines
  // and num_commit_failures for commit health.
  sql: [
    {
      since: '22.8',
      description:
        'Base consumer state: poll/commit activity, messages read, last exception',
      sql: `
      SELECT
        database,
        table,
        consumer_id,
        assignments.topic AS topics,
        assignments.partition_id AS partitions,
        last_poll_time,
        num_messages_read,
        last_commit_time,
        num_commits,
        last_exception_time,
        last_exception
      FROM system.kafka_consumers
      ORDER BY table
    `,
    },
    {
      since: '25.12',
      description:
        'Adds dependencies and missing_dependencies to detect broken Kafka→MV pipelines',
      sql: `
      SELECT
        database,
        table,
        consumer_id,
        assignments.topic AS topics,
        assignments.partition_id AS partitions,
        last_poll_time,
        num_messages_read,
        last_commit_time,
        num_commits,
        num_commit_failures,
        last_exception_time,
        last_exception,
        arrayStringConcat(dependencies, ', ') AS dependencies,
        arrayStringConcat(missing_dependencies, ', ') AS missing_dependencies
      FROM system.kafka_consumers
      ORDER BY table
    `,
    },
  ],
  columns: [
    'database',
    'table',
    'consumer_id',
    'topics',
    'partitions',
    'last_poll_time',
    'num_messages_read',
    'last_commit_time',
    'num_commits',
    'num_commit_failures',
    'last_exception_time',
    'last_exception',
    'dependencies',
    'missing_dependencies',
  ],
  columnFormats: {
    database: ColumnFormat.ColoredBadge,
    table: ColumnFormat.ColoredBadge,
    num_messages_read: ColumnFormat.NumberShort,
    num_commits: ColumnFormat.NumberShort,
    num_commit_failures: ColumnFormat.Number,
    last_exception: ColumnFormat.CodeDialog,
    dependencies: ColumnFormat.CodeToggle,
    missing_dependencies: ColumnFormat.ColoredBadge,
  },
  rowClassName: (row) => {
    // Amber: missing MV pipeline targets (broken Kafka→MV pipeline, CH 25.12+)
    const missingDeps = String(row.missing_dependencies || '')
    if (missingDeps !== '') return 'bg-amber-50 dark:bg-amber-950/20'
    // Red: consumer exception
    const lastException = String(row.last_exception || '')
    if (lastException !== '') return 'bg-red-50 dark:bg-red-950/20'
    return ''
  },
}
