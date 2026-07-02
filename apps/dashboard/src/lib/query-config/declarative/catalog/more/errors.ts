import type { DeclarativeQueryConfig } from '../../schema'

const errorsTail = `
      FROM system.error_log
      WHERE if({error: String} != '', error = {error: String}, true)
      ORDER BY event_time DESC
      LIMIT 100`

export const errorsDeclarative: DeclarativeQueryConfig = {
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
  // Keep this file in sync with more/errors.ts (the imperative mirror).
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
  ],
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
    error: ['link', { href: `?error=[error]` }],
    remote: 'boolean',
  },
  defaultParams: { error: '' },
  filterParamPresets: [
    { name: 'KEEPER_EXCEPTION', key: 'error', value: 'KEEPER_EXCEPTION' },
    {
      name: 'PART_IS_TEMPORARILY_LOCKED',
      key: 'error',
      value: 'PART_IS_TEMPORARILY_LOCKED',
    },
    {
      name: 'TABLE_IS_READ_ONLY',
      key: 'error',
      value: 'TABLE_IS_READ_ONLY',
    },
    {
      name: 'NO_REPLICA_HAS_PART',
      key: 'error',
      value: 'NO_REPLICA_HAS_PART',
    },
    { name: 'INCORRECT_DATA', key: 'error', value: 'INCORRECT_DATA' },
    { name: 'TIMEOUT_EXCEEDED', key: 'error', value: 'TIMEOUT_EXCEEDED' },
    {
      name: 'CANNOT_PARSE_INPUT_ASSERTION_FAILED',
      key: 'error',
      value: 'CANNOT_PARSE_INPUT_ASSERTION_FAILED',
    },
    { name: 'ABORTED', key: 'error', value: 'ABORTED' },
    { name: 'TOO_MANY_PARTS', key: 'error', value: 'TOO_MANY_PARTS' },
    {
      name: 'CHECKSUM_DOESNT_MATCH',
      key: 'error',
      value: 'CHECKSUM_DOESNT_MATCH',
    },
    { name: 'NETWORK_ERROR', key: 'error', value: 'NETWORK_ERROR' },
  ],
  relatedCharts: [['zookeeper-exception', {}]],
}
