import type { DeclarativeQueryConfig } from '../../schema'

export const mergesDeclarative: DeclarativeQueryConfig = {
  name: 'merges',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['merge_type', 'is_mutation'] },
  refreshInterval: 30000,
  description:
    'Merges and part mutations currently in process for tables in the MergeTree family',
  // Version-aware queries (oldest → newest)
  // 26.6 adds per-projection tracking: current_projection,
  // current_projection_progress, projections_completed, projections_remaining.
  sql: [
    {
      since: '19.1',
      description: 'Base query — projection tracking columns not available',
      sql: `
        SELECT *,
          database || '.' || table as table,
          round(100 * num_parts / nullIf(max(num_parts) OVER (), 0)) as pct_num_parts,
          round(progress * 100, 1) as pct_progress,
          (cast(pct_progress, 'String') || '%') as readable_progress,
          round(100 * rows_read / nullIf(max(rows_read) OVER (), 0)) as pct_rows_read,
          formatReadableQuantity(rows_read) as readable_rows_read,
          round(100 * rows_written / nullIf(max(rows_written) OVER (), 0)) as pct_rows_written,
          formatReadableQuantity(rows_written) as readable_rows_written,
          round(100 * memory_usage / nullIf(max(memory_usage) OVER (), 0)) as pct_memory_usage,
          formatReadableSize(memory_usage) as readable_memory_usage,
          '-' AS current_projection,
          toFloat64(0) AS current_projection_progress,
          '0%' AS readable_current_projection_progress,
          toFloat64(0) AS pct_current_projection_progress,
          toUInt64(0) AS projections_completed,
          toUInt64(0) AS projections_remaining
        FROM system.merges
        ORDER BY progress DESC
      `,
    },
    {
      since: '26.6',
      description:
        'Includes projection tracking: current_projection, projections_completed/remaining',
      sql: `
        SELECT *,
          database || '.' || table as table,
          round(100 * num_parts / nullIf(max(num_parts) OVER (), 0)) as pct_num_parts,
          round(progress * 100, 1) as pct_progress,
          (cast(pct_progress, 'String') || '%') as readable_progress,
          round(100 * rows_read / nullIf(max(rows_read) OVER (), 0)) as pct_rows_read,
          formatReadableQuantity(rows_read) as readable_rows_read,
          round(100 * rows_written / nullIf(max(rows_written) OVER (), 0)) as pct_rows_written,
          formatReadableQuantity(rows_written) as readable_rows_written,
          round(100 * memory_usage / nullIf(max(memory_usage) OVER (), 0)) as pct_memory_usage,
          formatReadableSize(memory_usage) as readable_memory_usage,
          concat(toString(round(current_projection_progress * 100, 1)), '%')
            AS readable_current_projection_progress,
          round(current_projection_progress * 100, 0)
            AS pct_current_projection_progress
        FROM system.merges
        ORDER BY progress DESC
      `,
    },
  ],
  columns: [
    'table',
    'partition_id',
    'elapsed',
    'readable_progress',
    'num_parts',
    'readable_rows_read',
    'readable_rows_written',
    'readable_memory_usage',
    'is_mutation',
    'merge_type',
    'merge_algorithm',
    'current_projection',
    'readable_current_projection_progress',
    'projections_completed',
    'projections_remaining',
  ],
  columnFormats: {
    table: 'colored-badge',
    elapsed: 'duration',
    is_mutation: 'boolean',
    num_parts: 'background-bar',
    readable_progress: 'background-bar',
    readable_memory_usage: 'background-bar',
    readable_rows_read: 'background-bar',
    readable_rows_written: 'background-bar',
    current_projection: 'code',
    readable_current_projection_progress: 'background-bar',
    projections_completed: 'number',
    projections_remaining: 'number',
  },
  relatedCharts: [
    [
      'summary-used-by-merges',
      {
        title: 'Merge Summary',
      },
    ],
    [
      'merge-count',
      {
        title: 'Merge/Mutations',
        interval: 'toStartOfDay',
        lastHours: 336,
      },
    ],
  ],
  optional: false,
}
