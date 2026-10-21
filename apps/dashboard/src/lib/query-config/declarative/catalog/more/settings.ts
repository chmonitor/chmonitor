import type { DeclarativeQueryConfig } from '../../schema'

const SETTINGS_COLUMNS = ['name', 'value', 'changed', 'description', 'default']

export const settingsDeclarative: DeclarativeQueryConfig = {
  name: 'settings',
  optional: false,
  defaultView: 'auto',
  card: { primary: 'name', badges: ['changed'] },
  permission: { feature: 'settings' },
  tableCheck: 'system.settings',
  sql: `
      SELECT *
      FROM system.settings
      WHERE {changed: String} = '' OR toString(changed) = {changed: String}
      ORDER BY name
  `,
  columns: SETTINGS_COLUMNS,
  expandable: { type: 'config-details', primaryColumns: SETTINGS_COLUMNS },
  columnFormats: {
    name: 'code',
    changed: 'boolean',
    value: 'code',
    default: 'code',
    description: 'markdown',
  },
  defaultParams: {
    changed: '',
  },
  filterParamPresets: [
    {
      name: 'Changed only',
      key: 'changed',
      value: '1',
    },
  ],
}
