import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { queryViewsLogConfig } from '@/lib/query-config/queries/query-views-log'

const QueryViewsLogPage = createPage({
  queryConfig: queryViewsLogConfig,
  title: 'Query Views Log',
})

export const Route = createFileRoute('/(dashboard)/query-views-log')({
  component: QueryViewsLogPage,
  head: () => pageOgHead('query-views-log'),
})
