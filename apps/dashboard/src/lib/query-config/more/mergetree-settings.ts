import type { QueryConfig } from '@/types/query-config'

import { ColumnFormat } from '@/types/column-format'

export const mergeTreeSettingsConfig: QueryConfig = {
  name: 'mergetree-settings',
  defaultView: 'auto',
  card: { primary: 'name', badges: ['changed', 'type'] },
  permission: { feature: 'settings' },
  tableCheck: 'system.merge_tree_settings',
  // merge_tree_settings.is_obsolete arrives in 23.8; 23.3 cannot flag obsolete
  // settings, so it reports 0.
  sql: [
    {
      since: '23.3',
      description: 'is_obsolete stubbed as 0 (no such column on 23.3)',
      sql: `
          SELECT name, value, changed, description, readonly, min, max, type, toUInt8(0) AS is_obsolete
          FROM system.merge_tree_settings
          ORDER BY name
        `,
    },
    {
      since: '23.8',
      description: 'Includes is_obsolete',
      sql: `
          SELECT name, value, changed, description, readonly, min, max, type, is_obsolete
          FROM system.merge_tree_settings
          ORDER BY name
        `,
    },
  ],
  columns: [
    'name',
    'value',
    'changed',
    'description',
    'readonly',
    'min',
    'max',
    'type',
    'is_obsolete',
  ],
  columnFormats: {
    changed: ColumnFormat.Boolean,
    readonly: ColumnFormat.Boolean,
    is_obsolete: ColumnFormat.Boolean,
    value: ColumnFormat.Code,
    type: ColumnFormat.ColoredBadge,
  },
}
