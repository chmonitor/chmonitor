import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { unusedTablesConfig } from '@/lib/query-config/more/unused-tables'

const UnusedTablesPage = createPage({
  queryConfig: unusedTablesConfig,
  title: 'Unread Tables',
})

export const Route = createFileRoute('/(dashboard)/unused-tables')({
  component: UnusedTablesPage,
  head: () => pageOgHead('unused-tables'),
})
