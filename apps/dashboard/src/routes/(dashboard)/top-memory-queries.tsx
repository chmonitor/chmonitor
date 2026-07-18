import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { topMemoryQueriesLiveConfig } from '@/lib/query-config/queries/top-memory-queries-live'

const TopMemoryQueriesPage = createPage({
  queryConfig: topMemoryQueriesLiveConfig,
  title: 'Top Memory Queries',
})

export const Route = createFileRoute('/(dashboard)/top-memory-queries')({
  component: TopMemoryQueriesPage,
})
