import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { movesConfig } from '@/lib/query-config/tables/moves'

function MovesPageContent() {
  return <PageLayout queryConfig={movesConfig} title="Moves" />
}

function MovesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MovesPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/moves')({
  component: MovesPage,
  head: () => pageOgHead('moves'),
})
