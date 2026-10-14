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
