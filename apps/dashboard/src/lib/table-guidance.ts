/**
 * Table guidance configuration
 *
 * Maps ClickHouse system table names to enable instructions and documentation links.
 * Used to provide helpful guidance when optional tables are not available.
 */

import { EVENTS_TABLE } from '@/lib/app-tables'

export interface TableGuidance {
  /** How to enable this table in ClickHouse */
  enableInstructions: string
  /** Link to official ClickHouse documentation */
  docsUrl?: string
  /** Short description of what this table provides */
  description?: string
}

const EVENTS_TABLE_GUIDANCE: TableGuidance = {
  description: "chmonitor's own usage-analytics table",
  enableInstructions:
    'Page Views is self-analytics — it records views of the chmonitor dashboard itself into a `monitoring_events` table on this ClickHouse host, separate from your cluster data. ' +
    'The table is created on demand by an authenticated request to `POST /api/init?hostId=<n>`, which needs a ClickHouse user with CREATE TABLE (and INSERT) rights. ' +
    'On a read-only host (such as the public demo) it stays unavailable by design. Once created, dashboard views are recorded automatically.',
}

/**
 * Guidance for optional ClickHouse system tables
 */
export const TABLE_GUIDANCE: Record<string, TableGuidance> = {
  'system.query_thread_log': {
    description: 'Per-thread query execution statistics',
    enableInstructions:
      'Enable by setting `log_query_threads = 1` in your ClickHouse config or per-query.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/query_thread_log',
  },
  'system.session_log': {
    description: 'Login attempts and session tracking',
    enableInstructions:
      'Enable by adding the `<session_log>` section to your ClickHouse server config.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/session_log',
  },
  'system.processors_profile_log': {
    description: 'Query processor profiling data',
    enableInstructions:
      'Enable by setting `log_processors_profiles = 1` in your ClickHouse config.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/processors_profile_log',
  },
  'system.error_log': {
    description: 'System error history',
    enableInstructions:
      'Enable by adding the `<error_log>` section to your ClickHouse server config.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/error_log',
  },
  'system.zookeeper': {
    description: 'ZooKeeper/Keeper cluster coordination data',
    enableInstructions:
      'This table is only available when ZooKeeper or ClickHouse Keeper is configured for your cluster.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/zookeeper',
  },
  'system.zookeeper_info': {
    description: 'Introspection of all available Keeper/ZooKeeper nodes',
    enableInstructions:
      'This table is only available when ZooKeeper or ClickHouse Keeper is configured. It was introduced in a recent ClickHouse release — older servers will not expose it.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_info',
  },
  'system.zookeeper_connection': {
    description: 'Current connections to ZooKeeper/Keeper',
    enableInstructions:
      'This table is only available when ZooKeeper or ClickHouse Keeper is configured for your cluster.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_connection',
  },
  'system.zookeeper_connection_log': {
    description: 'History of ZooKeeper/Keeper connection events',
    enableInstructions:
      'This table is only available when ZooKeeper or ClickHouse Keeper is configured. It was introduced in a recent ClickHouse release — older servers will not expose it.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_connection_log',
  },
  'system.zookeeper_log': {
    description: 'Per-request log of ZooKeeper/Keeper operations',
    enableInstructions:
      'Enable by adding the `<zookeeper_log>` section to your ClickHouse server config. It is not enabled by default even when Keeper/ZooKeeper is configured.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_log',
  },
  'system.zookeeper_watches': {
    description: 'Currently active ZooKeeper/Keeper watches',
    enableInstructions:
      'This table is only available when ZooKeeper or ClickHouse Keeper is configured. It was introduced in a recent ClickHouse release — older servers will not expose it.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/zookeeper_watches',
  },
  'system.backup_log': {
    description: 'Backup operation history',
    enableInstructions:
      'This table is created after running your first BACKUP command. Run a backup to enable this feature.',
    docsUrl: 'https://clickhouse.com/docs/en/operations/backup',
  },
  'system.text_log': {
    description: 'Server log messages',
    enableInstructions:
      'The system.text_log table is not enabled in your ClickHouse configuration. To enable it, add the following to your config.xml or create a new file in config.d/:' +
      '\n\n```xml\n<text_log>\n  <database>system</database>\n  <table>text_log</table>\n  <flush_interval_milliseconds>7500</flush_interval_milliseconds>\n</text_log>\n```\n\n' +
      'After adding the configuration, restart your ClickHouse server.',
    docsUrl: 'https://clickhouse.com/docs/en/operations/system-tables/text_log',
  },
  'system.crash_log': {
    description: 'Server crash history',
    enableInstructions:
      'The system.crash_log table is not present on this ClickHouse cluster. This table is automatically created by ClickHouse when server crashes occur. If no crashes have been logged yet, this table may not exist. This is normal for healthy clusters with no crash history. The table will be created automatically when the first crash is detected.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/crash_log',
  },
  [EVENTS_TABLE]: EVENTS_TABLE_GUIDANCE,
  ...(EVENTS_TABLE !== 'system.monitoring_events'
    ? { 'system.monitoring_events': EVENTS_TABLE_GUIDANCE }
    : {}),
  'system.opentelemetry_span_log': {
    description: 'OpenTelemetry tracing data',
    enableInstructions:
      'Enable by setting `opentelemetry_span_log_enabled = 1` and configuring OpenTelemetry in your ClickHouse server config.',
    docsUrl: 'https://clickhouse.com/docs/en/operations/opentelemetry',
  },
  'system.query_views_log': {
    description: 'Query views execution log',
    enableInstructions:
      'Enable by setting `log_query_views = 1` in your ClickHouse config.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/query_views_log',
  },
  'system.metric_log': {
    description: 'System metrics history (required for Merge/Mutations charts)',
    enableInstructions:
      'The system.metric_log table requires explicit configuration in ClickHouse. This table does not exist by default.\n\n' +
      'Add to your config.xml or config.d/metric_log.xml:\n\n' +
      '```xml\n<metric_log>\n  <database>system</database>\n  <table>metric_log</table>\n  <collect_interval_milliseconds>1000</collect_interval_milliseconds>\n  <flush_interval_milliseconds>7500</flush_interval_milliseconds>\n</metric_log>\n```\n\n' +
      'Also consider enabling part_log for merge duration/performance charts:\n\n' +
      '```xml\n<part_log>\n  <database>system</database>\n  <table>part_log</table>\n  <flush_interval_milliseconds>7500</flush_interval_milliseconds>\n</part_log>\n```\n\n' +
      'After adding the configuration, restart your ClickHouse server.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/metric_log',
  },
  'system.asynchronous_metric_log': {
    description: 'Asynchronous metrics history',
    enableInstructions:
      'Enable by adding the `<asynchronous_metric_log>` section to your ClickHouse server config.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/asynchronous_metric_log',
  },
  'system.trace_log': {
    description: 'Stack traces for sampling query profiler',
    enableInstructions:
      'Enable by setting `trace_log_enabled = 1` and configuring the query profiler settings like `query_profiler_real_time_period_ns`.',
    docsUrl:
      'https://clickhouse.com/docs/en/operations/system-tables/trace_log',
  },
  'system.part_log': {
    description:
      'Data part operations log (required for merge duration/performance charts)',
    enableInstructions:
      'The system.part_log table requires explicit configuration in ClickHouse. This table does not exist by default.\n\n' +
      'Add to your config.xml or config.d/part_log.xml:\n\n' +
      '```xml\n<part_log>\n  <database>system</database>\n  <table>part_log</table>\n  <flush_interval_milliseconds>7500</flush_interval_milliseconds>\n</part_log>\n```\n\n' +
      'After adding the configuration, restart your ClickHouse server.',
    docsUrl: 'https://clickhouse.com/docs/en/operations/system-tables/part_log',
  },
}

/**
 * Get guidance for a specific table
 */
export function getTableGuidance(tableName: string): TableGuidance | undefined {
  return TABLE_GUIDANCE[tableName]
}

/**
 * Get guidance for an array of missing tables
 * Returns the first table's guidance if multiple are missing
 */
export function getGuidanceForMissingTables(
  tables: readonly string[]
): TableGuidance | undefined {
  for (const table of tables) {
    const guidance = getTableGuidance(table)
    if (guidance) {
      return guidance
    }
  }
  return undefined
}
