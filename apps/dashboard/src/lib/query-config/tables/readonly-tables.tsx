import type { QueryConfig } from '@/types/query-config'

import { ReadonlyTableDetails } from '@/components/data-table/cells/readonly-table-details'
import { ColumnFormat } from '@/types/column-format'

export const readOnlyTablesConfig: QueryConfig = {
  name: 'readonly-tables',
  defaultView: 'auto',
  card: { primary: 'table', badges: ['is_readonly'] },
  description: `Readonly tables and their replicas`,
  sql: [
    {
      since: '19.1',
      description:
        'Base query for system.replicas - all columns available since early versions',
      sql: `
        SELECT
          database || '.' || table as table,
          is_readonly,
          absolute_delay,
          zookeeper_path,
          last_queue_update_exception,
          last_queue_update,
          zookeeper_exception,
          total_replicas,
          active_replicas,
          is_leader,
          is_session_expired,
          replica_name,
          replica_path,
          log_pointer,
          engine
        FROM system.replicas
        WHERE is_readonly = 1
        ORDER BY database, table
      `,
    },
  ],
  columns: [
    'table',
    'is_readonly',
    'absolute_delay',
    'zookeeper_path',
    'last_queue_update_exception',
    'last_queue_update',
    'zookeeper_exception',
    'total_replicas',
    'active_replicas',
    'is_leader',
    'is_session_expired',
    'replica_name',
    'replica_path',
    'log_pointer',
    'engine',
    'action',
  ],
  columnFormats: {
    table: ColumnFormat.ColoredBadge,
    engine: ColumnFormat.ColoredBadge,
    is_leader: ColumnFormat.Boolean,
    can_become_leader: ColumnFormat.Boolean,
    is_readonly: ColumnFormat.BooleanInverted,
    is_session_expired: ColumnFormat.Boolean,
    replica_name: ColumnFormat.ColoredBadge,
    action: [ColumnFormat.Action, ['generate-ai-prompt']],
  },
  relatedCharts: [
    [
      'readonly-replica',
      {
        title: 'Readonly Replica',
        interval: 'toStartOfHour',
        lastHours: 24,
      },
    ],
  ],
  expandable: {
    renderExpanded: (row) => <ReadonlyTableDetails row={row} />,
  },
}
