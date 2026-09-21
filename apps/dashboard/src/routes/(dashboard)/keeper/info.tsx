import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { KeeperNodeCards } from '@/components/keeper/keeper-node-cards'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { keeperInfoConfig } from '@/lib/query-config/keeper'

function KeeperInfoPageContent() {
  return (
    <PageLayout
      queryConfig={keeperInfoConfig}
      title="Keeper Info"
      tableSlot={<KeeperNodeCards />}
    />
  )
}

function KeeperInfoPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KeeperInfoPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/keeper/info')({
  component: KeeperInfoPage,
  head: () => pageOgHead('keeper/info'),
})
