import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PartLogView } from '@/components/part-log'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'

function PartLogPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PartLogView />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/part-log')({
  component: PartLogPage,
  head: () => pageOgHead('part-log'),
})
