import type { DeclarativeQueryConfig } from '../../schema'

export const asynchronousInsertsDeclarative: DeclarativeQueryConfig = {
  name: 'asynchronous-inserts',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['database', 'table'] },
  description:
    'Live async-insert queue: pending entries per table, bytes queued, and oldest entry age (system.asynchronous_inserts). Note: since CH 26.2 insert deduplication is ON by default.',
  refreshInterval: 10_000,
  optional: true,
  tableCheck: 'system.asynchronous_inserts',
  sql: `
    SELECT
      database,
      table,
      format,
      first_update,
      dateDiff('second', first_update, now()) AS age_seconds,
      formatReadableTimeDelta(dateDiff('second', first_update, now())) AS readable_age,
      round(dateDiff('second', first_update, now()) * 100.0 / nullIf(max(dateDiff('second', first_update, now())) OVER (), 0), 2) AS pct_age,
      total_bytes,
      formatReadableSize(total_bytes) AS readable_total_bytes,
      round(total_bytes * 100.0 / nullIf(max(total_bytes) OVER (), 0), 2) AS pct_total_bytes,
      length(entries.query_id) AS pending_entries,
      formatReadableQuantity(pending_entries) AS readable_pending_entries,
      round(pending_entries * 100.0 / nullIf(max(pending_entries) OVER (), 0), 2) AS pct_pending_entries
    FROM system.asynchronous_inserts
    ORDER BY total_bytes DESC
  `,
  columns: [
    'database',
    'table',
    'format',
    'first_update',
    'readable_age',
    'readable_total_bytes',
    'readable_pending_entries',
  ],
  columnFormats: {
    database: 'colored-badge',
    table: 'colored-badge',
    readable_age: 'background-bar',
    readable_total_bytes: 'background-bar',
    readable_pending_entries: 'background-bar',
  },
}
