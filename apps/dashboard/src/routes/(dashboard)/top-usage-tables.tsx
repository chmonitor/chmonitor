import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { topUsageTablesConfig } from '@/lib/query-config/more/top-usage-tables'

const TopUsageTablesPage = createPage({
  queryConfig: topUsageTablesConfig,
  title: 'Top Usage Tables',
})

export const Route = createFileRoute('/(dashboard)/top-usage-tables')({
  component: TopUsageTablesPage,
  head: () => pageOgHead('top-usage-tables'),
})
