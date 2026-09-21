import { createFileRoute } from '@tanstack/react-router'

import { createPage } from '@/lib/create-page'
import { pageOgHead } from '@/lib/og'
import { metricsConfig } from '@/lib/query-config/more/metrics'

const MetricsPage = createPage({
  queryConfig: metricsConfig,
  title: 'Metrics',
})

export const Route = createFileRoute('/(dashboard)/metrics')({
  component: MetricsPage,
  head: () => pageOgHead('metrics'),
})
