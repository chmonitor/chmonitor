import { TableIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

/** Shared leaf so Data Explorer can sit under both Tools and Tables. */
export const dataExplorerItem: MenuItem = {
  title: 'Data Explorer',
  href: '/explorer',
  description: 'Interactive database schema browser with metadata',
  countKey: 'tables-explorer',
  countLabel: 'tables',
  icon: TableIcon,
  docs: 'https://clickhouse.com/docs/en/operations/system-tables/databases', // pragma: allowlist secret
  tableCheck: ['system.databases', 'system.tables'],
  permission: { feature: 'tables' },
}
