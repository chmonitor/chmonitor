import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const replicatedMergeTreeSettingsConfig: QueryConfig = {
  name: 'replicated-merge-tree-settings',
  defaultView: 'auto',
  card: { primary: 'name', badges: ['changed', 'type'] },
  description:
    'Replicated MergeTree engine settings and whether each was changed from default',
  optional: true,
  tableCheck: 'system.replicated_merge_tree_settings',
  sql: `SELECT name, value, changed, description, type FROM system.replicated_merge_tree_settings ORDER BY name`,
  columns: ['name', 'value', 'changed', 'description', 'type'],
  columnFormats: {
    changed: ColumnFormat.Boolean,
    value: ColumnFormat.Code,
    type: ColumnFormat.ColoredBadge,
  },
}
