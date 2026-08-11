import type { DeclarativeQueryConfig } from '../../schema'

// Inlined thresholds from the legacy config:
//   STUCK_THRESHOLD_SECONDS = 600 (used in the SQL is_stuck expression)
//   LONG_RUNNING_THRESHOLD_SECONDS = 300 (used in the rowStyle amber rule)
export const mutationsDeclarative: DeclarativeQueryConfig = {
  name: 'mutations',
  optional: false,
  defaultView: 'auto',
  card: { primary: 'command', badges: ['is_done', 'is_stuck'] },
  refreshInterval: 30_000,
  description:
    'Information about mutations of MergeTree tables and their progress',
  // Version-aware queries (oldest → newest)
  // 25.12 adds parts_in_progress_names: names of parts currently being mutated.
  // 26.2 adds parts_postpone_reasons: why parts were postponed from mutating.
  // The expanded row panel surfaces both fields (expandable below).
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
          if(is_done = 0 AND parts_to_do > 0 AND (now() - create_time) > ${600}, 1, 0) AS is_stuck,
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
          if(is_done = 0 AND parts_to_do > 0 AND (now() - create_time) > ${600}, 1, 0) AS is_stuck,
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
          if(is_done = 0 AND parts_to_do > 0 AND (now() - create_time) > ${600}, 1, 0) AS is_stuck,
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
    table: 'colored-badge',
    command: 'code-dialog',
    is_done: 'boolean',
    is_stuck: 'boolean',
    elapsed: 'duration',
    readable_parts_to_do: 'background-bar',
  },
  // Expanding a row surfaces parts_to_do_names, parts_in_progress_names
  // (CH 25.12+), and parts_postpone_reasons (CH 26.2+) in the full-width
  // detail panel.
  expandable: {
    type: 'config-details',
    primaryColumns: [
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
  },
  // Replaces the legacy rowClassName:
  //   is_stuck truthy           -> red
  //   !is_done AND elapsed > 300 -> amber
  // default '' matches the legacy no-match return.
  rowStyle: {
    rules: [
      {
        when: { column: 'is_stuck', op: 'truthy' },
        className: 'bg-red-50 dark:bg-red-950/20',
      },
      {
        when: {
          all: [
            { column: 'is_done', op: 'falsy' },
            { column: 'elapsed', op: 'gt', value: 300 },
          ],
        },
        className: 'bg-amber-50 dark:bg-amber-950/20',
      },
    ],
    default: '',
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
        lastHours: 336,
      },
    ],
  ],
}
