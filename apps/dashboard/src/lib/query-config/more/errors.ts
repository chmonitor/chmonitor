import type { QueryConfig, VersionedSql } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

/** Base WHERE predicate shared across all version variants. */
const errorsTail = `
      FROM system.error_log
      WHERE if({error: String} != '', error = {error: String}, true)
      ORDER BY event_time DESC
      LIMIT 100`

export const errorsConfig: QueryConfig = {
  name: 'errors',
  defaultView: 'auto',
  card: { primary: 'error', badges: ['remote'] },
  description: 'System error logs and history',
  optional: true,
  tableCheck: 'system.error_log',
  // NOTE (issue #2138): A previous `since: '25.12'` variant SELECTed
  // last_error_time / last_error_message / last_error_query_id /
  // last_error_trace FROM system.error_log. In verified ClickHouse versions
  // those `last_error_*` columns belong to the AGGREGATED system.errors table
  // (see queries/common-errors.ts), NOT the per-event system.error_log
  // (hostname, event_date, event_time, code, error, value, remote). A
  // non-existent column makes ClickHouse fail the ENTIRE query on servers, and
  // the table-validator checks table existence, not columns, so it cannot save
  // this. The variant was removed as a conservative fix (a broken variant is
  // worse than a missing feature). If a maintainer confirms on a live 25.12+
  // server that system.error_log actually exposes these `last_error_*` columns,
  // the variant may be re-added here (sourced from the correct table).
  sql: [
    {
      since: '23.8',
      description: 'Base query — columns available in all supported versions',
      sql: `
      SELECT
          event_time,
          event_date,
          code,
          error,
          value,
          remote,
          hostname
      ${errorsTail}
  `,
    },
  ] as VersionedSql[],
  columns: [
    'event_time',
    'event_date',
    'code',
    'error',
    'value',
    'remote',
    'hostname',
  ],
  columnFormats: {
    error: [ColumnFormat.Link, { href: `?error=[error]` }],
    remote: ColumnFormat.Boolean,
  },
  defaultParams: { error: '' },
  // Common ClickHouse error types for quick filtering
  // These are frequently occurring errors in production environments
  // Future improvement: fetch distinct error types dynamically from system.error_log
  filterParamPresets: [
    ...[
      'KEEPER_EXCEPTION',
      'PART_IS_TEMPORARILY_LOCKED',
      'TABLE_IS_READ_ONLY',
      'NO_REPLICA_HAS_PART',
      'INCORRECT_DATA',
      'TIMEOUT_EXCEEDED',
      'CANNOT_PARSE_INPUT_ASSERTION_FAILED',
      'ABORTED',
      'TOO_MANY_PARTS',
      'CHECKSUM_DOESNT_MATCH',
      'NETWORK_ERROR',
    ].map((error) => ({
      name: error,
      key: 'error',
      value: error,
    })),
  ],
  relatedCharts: [['zookeeper-exception', {}]],
}
