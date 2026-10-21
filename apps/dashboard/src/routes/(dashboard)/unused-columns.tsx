import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { unusedColumnsConfig } from '@/lib/query-config/more/unused-columns'

const UnusedColumnsPage = createPage({
  queryConfig: unusedColumnsConfig,
  title: 'Unread Columns',
})

export const Route = createFileRoute('/(dashboard)/unused-columns')({
  component: UnusedColumnsPage,
  head: () => pageOgHead('unused-columns'),
})
