import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { zookeeperConfig } from '@/lib/query-config/more/zookeeper'

function KeeperBrowserPageContent() {
  return (
    <PageLayout queryConfig={zookeeperConfig} title="Keeper Data Browser" />
  )
}

function KeeperBrowserPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KeeperBrowserPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/keeper/')({
  component: KeeperBrowserPage,
  head: () => pageOgHead('keeper'),
})
