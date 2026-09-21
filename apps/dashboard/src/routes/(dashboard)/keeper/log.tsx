import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { keeperLogConfig } from '@/lib/query-config/keeper'

function KeeperLogPageContent() {
  return <PageLayout queryConfig={keeperLogConfig} title="Keeper Request Log" />
}

function KeeperLogPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KeeperLogPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/keeper/log')({
  component: KeeperLogPage,
  head: () => pageOgHead('keeper/log'),
})
