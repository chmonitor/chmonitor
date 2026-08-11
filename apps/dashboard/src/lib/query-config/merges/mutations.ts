import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

/** Threshold in seconds for marking a mutation as stuck (10 minutes) */
export const STUCK_THRESHOLD_SECONDS = 600
/** Threshold in seconds for highlighting long-running mutations (5 minutes) */
export const LONG_RUNNING_THRESHOLD_SECONDS = 300

export const mutationsConfig: QueryConfig = {
  name: 'mutations',
  defaultView: 'auto',
  card: { primary: 'command', badges: ['is_done', 'is_stuck'] },
  refreshInterval: 30_000,
  description:
    'Information about mutations of MergeTree tables and their progress',
  // Version-aware queries (oldest → newest)
  // 25.12 adds parts_in_progress_names: names of parts currently being mutated.
  // 26.2 adds parts_postpone_reasons: why parts were postponed from mutating.
  // The expanded row panel surfaces both fields (expandable: true below).
  sql: [
    {
      since: '19.1',
      description: 'Base query — parts_in_progress_names not available',
      sql: `
        SELECT
          database || '.' || table as table,
          mutation_id,
          command,
          create_time,
          now() - create_time AS elapsed,
          parts_to_do,
          formatReadableQuantity(parts_to_do) AS readable_parts_to_do,
          round(100 * parts_to_do / nullIf(max(parts_to_do) OVER (), 0), 2) as pct_parts_to_do,
          parts_to_do_names,
          [] AS parts_in_progress_names,
          is_done,
          if(is_done = 0 AND parts_to_do > 0 AND (now() - create_time) > ${STUCK_THRESHOLD_SECONDS}, 1, 0) AS is_stuck,
          latest_failed_part,
          latest_fail_time,
          latest_fail_reason
        FROM system.mutations
        ORDER BY is_done ASC, is_stuck DESC, create_time DESC
      `,
    },
    {
      since: '25.12',
      description:
        'Includes parts_in_progress_names: names of parts currently being mutated',
      sql: `
        SELECT
          database || '.' || table as table,
          mutation_id,
          command,
          create_time,
          now() - create_time AS elapsed,
          parts_to_do,
          formatReadableQuantity(parts_to_do) AS readable_parts_to_do,
          round(100 * parts_to_do / nullIf(max(parts_to_do) OVER (), 0), 2) as pct_parts_to_do,
          parts_to_do_names,
          parts_in_progress_names,
          is_done,
          if(is_done = 0 AND parts_to_do > 0 AND (now() - create_time) > ${STUCK_THRESHOLD_SECONDS}, 1, 0) AS is_stuck,
          latest_failed_part,
          latest_fail_time,
          latest_fail_reason
        FROM system.mutations
        ORDER BY is_done ASC, is_stuck DESC, create_time DESC
      `,
    },
    {
      since: '26.2',
      description:
        'Includes parts_postpone_reasons: why parts were postponed from mutating',
      sql: `
        SELECT
          database || '.' || table as table,
          mutation_id,
          command,
          create_time,
          now() - create_time AS elapsed,
          parts_to_do,
          formatReadableQuantity(parts_to_do) AS readable_parts_to_do,
          round(100 * parts_to_do / nullIf(max(parts_to_do) OVER (), 0), 2) as pct_parts_to_do,
          parts_to_do_names,
          parts_in_progress_names,
          parts_postpone_reasons,
          is_done,
          if(is_done = 0 AND parts_to_do > 0 AND (now() - create_time) > ${STUCK_THRESHOLD_SECONDS}, 1, 0) AS is_stuck,
          latest_failed_part,
          latest_fail_time,
          latest_fail_reason
        FROM system.mutations
        ORDER BY is_done ASC, is_stuck DESC, create_time DESC
      `,
    },
  ],
  columns: [
    'is_done',
    'is_stuck',
    'table',
    'mutation_id',
    'command',
    'create_time',
    'elapsed',
    'readable_parts_to_do',
    'latest_failed_part',
    'latest_fail_time',
    'latest_fail_reason',
  ],
  columnFormats: {
    table: ColumnFormat.ColoredBadge,
    command: ColumnFormat.CodeDialog,
    is_done: ColumnFormat.Boolean,
    is_stuck: ColumnFormat.Boolean,
    elapsed: ColumnFormat.Duration,
    readable_parts_to_do: ColumnFormat.BackgroundBar,
  },
  // Expanding a row surfaces parts_to_do_names, parts_in_progress_names
  // (CH 25.12+), and parts_postpone_reasons (CH 26.2+) in the full-width
  // JSON detail panel.
  expandable: true,
  rowClassName: (row) => {
    const isStuck = Number(row.is_stuck || 0)
    if (isStuck) return 'bg-red-50 dark:bg-red-950/20'
    const isDone = Number(row.is_done || 0)
    const elapsed = Number(row.elapsed || 0)
    if (!isDone && elapsed > LONG_RUNNING_THRESHOLD_SECONDS)
      return 'bg-amber-50 dark:bg-amber-950/20'
    return ''
  },
  relatedCharts: [
    [
      'summary-stuck-mutations',
      {
        title: 'Stuck Mutations',
      },
    ],
    [
      'summary-used-by-mutations',
      {
        title: 'Mutations Summary',
      },
    ],
    [
      'merge-count',
      {
        title: 'Merge/Mutations',
        interval: 'toStartOfDay',
        lastHours: 24 * 14,
      },
    ],
  ],
}
