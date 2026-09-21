import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { topUsageColumnsConfig } from '@/lib/query-config/more/top-usage-columns'

const TopUsageColumnsPage = createPage({
  queryConfig: topUsageColumnsConfig,
  title: 'Top Usage Columns',
})

export const Route = createFileRoute('/(dashboard)/top-usage-columns')({
  component: TopUsageColumnsPage,
  head: () => pageOgHead('top-usage-columns'),
})
