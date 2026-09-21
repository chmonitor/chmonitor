import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { profilerConfig } from '@/lib/query-config/queries/profiler'

function ProfilerContent() {
  return <PageLayout queryConfig={profilerConfig} title="Query Profiler" />
}

function ProfilerPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProfilerContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/profiler')({
  component: ProfilerPage,
  head: () => pageOgHead('profiler'),
})
