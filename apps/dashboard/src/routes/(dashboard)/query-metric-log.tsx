import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { queryMetricLogConfig } from '@/lib/query-config/system/query-metric-log'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'

function QueryMetricLogPageContent() {
  const searchParams = useUrlSearchParams()

  // When navigated from "View Resource Timeline" action on a query row,
  // ?query_id= is set to filter the metric log to that specific query.
  // ?last_hours= overrides the default 1-hour lookback window.
  const tableSearchParams: Record<string, string> = {}
  const queryId = searchParams.get('query_id')
  if (queryId?.trim()) {
    tableSearchParams.query_id = queryId.trim()
  }
  const lastHours = searchParams.get('last_hours')
  if (lastHours?.trim()) {
    tableSearchParams.last_hours = lastHours.trim()
  }

  return (
    <PageLayout
      queryConfig={queryMetricLogConfig}
      title="Query Metric Log"
      searchParams={tableSearchParams}
    />
  )
}

function QueryMetricLogPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <QueryMetricLogPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/query-metric-log')({
  component: QueryMetricLogPage,
})
