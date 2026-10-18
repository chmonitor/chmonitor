import type { DeclarativeQueryConfig } from '../../schema'

export const kafkaConsumersDeclarative: DeclarativeQueryConfig = {
  name: 'kafka-consumers',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['consumer_id'] },
  description:
    'Kafka table engine consumer state: poll/commit activity, messages read, and last exception per consumer',
  refreshInterval: 15000,
  // system.kafka_consumers only exists if Kafka table engines are configured
  optional: true,
  tableCheck: 'system.kafka_consumers',
  // CH 25.12 adds dependencies / missing_dependencies to detect broken Kafka→MV pipelines.
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
        exceptions.time[-1] AS last_exception_time,
        exceptions.text[-1] AS last_exception
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
        exceptions.time[-1] AS last_exception_time,
        exceptions.text[-1] AS last_exception,
        arrayStringConcat(arrayFlatten(dependencies), ', ') AS dependencies,
        arrayStringConcat(arrayFlatten(missing_dependencies), ', ') AS missing_dependencies
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
    'last_exception_time',
    'last_exception',
    'dependencies',
    'missing_dependencies',
  ],
  columnFormats: {
    database: 'colored-badge',
    table: 'colored-badge',
    num_messages_read: 'number-short',
    num_commits: 'number-short',
    last_exception: 'code-dialog',
    dependencies: 'code-toggle',
    missing_dependencies: 'colored-badge',
  },
  // Amber: missing MV pipeline targets (broken Kafka→MV pipeline, CH 25.12+)
  // Red: consumer exception
  rowStyle: {
    rules: [
      {
        when: { column: 'missing_dependencies', op: 'nonempty' },
        className: 'bg-amber-50 dark:bg-amber-950/20',
      },
      {
        when: { column: 'last_exception', op: 'nonempty' },
        className: 'bg-red-50 dark:bg-red-950/20',
      },
    ],
    default: '',
  },
}
