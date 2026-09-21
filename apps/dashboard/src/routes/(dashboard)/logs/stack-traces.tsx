import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { stackTracesConfig } from '@/lib/query-config/logs/stack-traces'

function StackTracesContent() {
  return (
    <PageLayout queryConfig={stackTracesConfig} title="Current Stack Traces" />
  )
}

function StackTracesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StackTracesContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/logs/stack-traces')({
  component: StackTracesPage,
  head: () => pageOgHead('logs/stack-traces'),
})
