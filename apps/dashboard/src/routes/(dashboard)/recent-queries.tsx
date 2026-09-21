import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { recentQueriesConfig } from '@/lib/query-config/queries/recent-queries'

const RecentQueriesPage = createPage({
  queryConfig: recentQueriesConfig,
  title: 'Recent Queries',
})

export const Route = createFileRoute('/(dashboard)/recent-queries')({
  component: RecentQueriesPage,
  head: () => pageOgHead('recent-queries'),
})
