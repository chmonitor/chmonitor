import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { KeeperNodeCards } from '@/components/keeper/keeper-node-cards'
import { KeeperOverviewKpis } from '@/components/keeper/keeper-overview-kpis'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { keeperOverviewConfig } from '@/lib/query-config/keeper'

function KeeperOverviewContent() {
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <KeeperOverviewKpis />
      <PageLayout
        queryConfig={keeperOverviewConfig}
        title="Keeper Nodes"
        tableSlot={<KeeperNodeCards />}
      />
    </div>
  )
}

function KeeperOverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KeeperOverviewContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/keeper/overview')({
  component: KeeperOverviewPage,
  head: () => pageOgHead('keeper/overview'),
})
