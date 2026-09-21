import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { errorsConfig } from '@/lib/query-config/more/errors'

function ErrorsPageContent() {
  return <PageLayout queryConfig={errorsConfig} title="Errors" />
}

function ErrorsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ErrorsPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/errors')({
  component: ErrorsPage,
  head: () => pageOgHead('errors'),
})
