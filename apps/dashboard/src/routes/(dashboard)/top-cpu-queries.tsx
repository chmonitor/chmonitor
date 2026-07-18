import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { topCpuQueriesConfig } from '@/lib/query-config/queries/top-cpu-queries'

const TopCpuQueriesPage = createPage({
  queryConfig: topCpuQueriesConfig,
  title: 'Top CPU Queries',
})

export const Route = createFileRoute('/(dashboard)/top-cpu-queries')({
  component: TopCpuQueriesPage,
})
