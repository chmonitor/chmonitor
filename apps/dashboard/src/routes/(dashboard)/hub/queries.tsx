import { createFileRoute } from '@tanstack/react-router'

import { HUB_CHARTS } from './-hub-charts'
import { Suspense } from 'react'
import { HubPage } from '@/components/hub/hub-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'

const HUB_HREF = '/hub/queries'

function QueriesHubPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HubPage hubHref={HUB_HREF} charts={HUB_CHARTS[HUB_HREF]} />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/hub/queries')({
  component: QueriesHubPage,
  head: () => pageOgHead('hub-queries'),
})
