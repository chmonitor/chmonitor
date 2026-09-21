import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { readOnlyTablesConfig } from '@/lib/query-config/tables/readonly-tables'

function ReadonlyTablesPageContent() {
  return (
    <PageLayout queryConfig={readOnlyTablesConfig} title="Readonly Tables" />
  )
}

function ReadonlyTablesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReadonlyTablesPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/readonly-tables')({
  component: ReadonlyTablesPage,
  head: () => pageOgHead('readonly-tables'),
})
