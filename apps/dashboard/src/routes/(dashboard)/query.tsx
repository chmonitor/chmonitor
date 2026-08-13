import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { QueryDetailView } from '@/components/query-detail/query-detail-view'
import { TableSkeleton } from '@/components/skeletons'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'

function QueryDetailContent() {
  const searchParams = useUrlSearchParams()
  const query_id = searchParams.get('query_id')

  if (!query_id) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-muted-foreground text-sm">Query ID is required</p>
      </div>
    )
  }

  return <QueryDetailView queryId={query_id} />
}

function QueryDetailPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <QueryDetailContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/query')({
  component: QueryDetailPage,
})
