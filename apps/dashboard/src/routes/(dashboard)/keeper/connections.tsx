import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { keeperConnectionsConfig } from '@/lib/query-config/keeper'

function KeeperConnectionsPageContent() {
  return (
    <PageLayout
      queryConfig={keeperConnectionsConfig}
      title="Keeper Connections"
    />
  )
}

function KeeperConnectionsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KeeperConnectionsPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/keeper/connections')({
  component: KeeperConnectionsPage,
  head: () => pageOgHead('keeper/connections'),
})
