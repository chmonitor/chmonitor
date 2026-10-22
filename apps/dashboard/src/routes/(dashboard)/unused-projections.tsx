import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { unusedProjectionsConfig } from '@/lib/query-config/more/unused-projections'

const UnusedProjectionsPage = createPage({
  queryConfig: unusedProjectionsConfig,
  title: 'Unused Projections',
})

export const Route = createFileRoute('/(dashboard)/unused-projections')({
  component: UnusedProjectionsPage,
  head: () => pageOgHead('unused-projections'),
})
