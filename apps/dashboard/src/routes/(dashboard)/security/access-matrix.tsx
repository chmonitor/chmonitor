import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { AccessMatrixView } from '@/components/security/access-matrix/access-matrix-view'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'

function AccessMatrixPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Access Matrix"
        description="Who can read or write what: effective grants per user or role, through nested roles, partial revokes and readonly profiles. Read from this node; switch on Compare replicas to check every replica of a cluster for drift."
      />
      <Suspense fallback={<PageSkeleton />}>
        <AccessMatrixView />
      </Suspense>
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/security/access-matrix')({
  component: AccessMatrixPage,
  head: () => pageOgHead('security/access-matrix'),
})
