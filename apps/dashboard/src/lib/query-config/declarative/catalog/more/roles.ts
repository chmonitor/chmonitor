import type { DeclarativeQueryConfig } from '../../schema'

export const rolesDeclarative: DeclarativeQueryConfig = {
  name: 'roles',
  permission: { feature: 'security' },
  defaultView: 'auto',
  card: { primary: 'name', badges: ['storage'] },
  description: 'Roles',
  optional: false,
  tableCheck: 'system.roles',
  sql: `
      SELECT *
      FROM system.roles
      ORDER BY name
    `,
  columns: ['name', 'id', 'storage'],
  columnFormats: {},
}
