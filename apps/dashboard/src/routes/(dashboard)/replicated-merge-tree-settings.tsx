import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { PageSkeleton } from '@/components/skeletons'
import { pageOgHead } from '@/lib/og'
import { replicatedMergeTreeSettingsConfig } from '@/lib/query-config/system/replicated-merge-tree-settings'

function ReplicatedMergeTreeSettingsPageContent() {
  return (
    <PageLayout
      queryConfig={replicatedMergeTreeSettingsConfig}
      title="Replicated MergeTree Settings"
    />
  )
}

function ReplicatedMergeTreeSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReplicatedMergeTreeSettingsPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute(
  '/(dashboard)/replicated-merge-tree-settings'
)({
  component: ReplicatedMergeTreeSettingsPage,
  head: () => pageOgHead('replicated-merge-tree-settings'),
})
