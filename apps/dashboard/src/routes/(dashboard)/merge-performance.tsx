import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { mergePerformanceConfig } from '@/lib/query-config/merges/merge-performance'

function MergePerformancePageContent() {
  return (
    <PageLayout
      queryConfig={mergePerformanceConfig}
      title="Merge Performance"
    />
  )
}

function MergePerformancePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MergePerformancePageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/merge-performance')({
  component: MergePerformancePage,
  head: () => pageOgHead('merge-performance'),
})
