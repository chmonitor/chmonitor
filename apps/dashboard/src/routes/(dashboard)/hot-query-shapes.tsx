import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { hotQueryShapesConfig } from '@/lib/query-config/more/hot-query-shapes'

const HotQueryShapesPage = createPage({
  queryConfig: hotQueryShapesConfig,
  title: 'Hot Query Shapes',
})

export const Route = createFileRoute('/(dashboard)/hot-query-shapes')({
  component: HotQueryShapesPage,
  head: () => pageOgHead('hot-query-shapes'),
})
