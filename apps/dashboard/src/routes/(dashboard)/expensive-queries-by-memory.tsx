import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { expensiveQueriesByMemoryConfig } from '@/lib/query-config/queries/expensive-queries-by-memory'

const ExpensiveQueriesByMemoryPage = createPage({
  queryConfig: expensiveQueriesByMemoryConfig,
  title: 'Most Expensive Queries by Memory',
})

export const Route = createFileRoute(
  '/(dashboard)/expensive-queries-by-memory'
)({
  component: ExpensiveQueriesByMemoryPage,
  head: () => pageOgHead('expensive-queries-by-memory'),
})
