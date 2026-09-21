import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { keeperConnectionLogConfig } from '@/lib/query-config/keeper'

function KeeperConnectionLogPageContent() {
  return (
    <PageLayout
      queryConfig={keeperConnectionLogConfig}
      title="Keeper Connection Log"
    />
  )
}

function KeeperConnectionLogPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KeeperConnectionLogPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/keeper/connection-log')({
  component: KeeperConnectionLogPage,
  head: () => pageOgHead('keeper/connection-log'),
})
