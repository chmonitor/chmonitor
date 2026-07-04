import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { slowQueryPatternsConfig } from '@/lib/query-config/queries/slow-query-patterns'

const SlowQueryPatternsPage = createPage({
  queryConfig: slowQueryPatternsConfig,
  title: 'Slow Query Patterns',
})

export const Route = createFileRoute('/(dashboard)/slow-query-patterns')({
  component: SlowQueryPatternsPage,
})
