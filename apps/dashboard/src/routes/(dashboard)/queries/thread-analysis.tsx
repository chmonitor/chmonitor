import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { threadAnalysisConfig } from '@/lib/query-config/queries/thread-analysis'

function ThreadAnalysisContent() {
  return (
    <PageLayout queryConfig={threadAnalysisConfig} title="Thread Analysis" />
  )
}

function ThreadAnalysisPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ThreadAnalysisContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/queries/thread-analysis')({
  component: ThreadAnalysisPage,
  head: () => pageOgHead('queries/thread-analysis'),
})
