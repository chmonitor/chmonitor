import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { warningsConfig } from '@/lib/query-config/system/warnings'

function WarningsPageContent() {
  return <PageLayout queryConfig={warningsConfig} title="Warnings" />
}

function WarningsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WarningsPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/warnings')({
  component: WarningsPage,
  head: () => pageOgHead('warnings'),
})
