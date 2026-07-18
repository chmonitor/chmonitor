import { createFileRoute, useSearch } from '@tanstack/react-router'

import { Suspense } from 'react'
import {
  HealthSettingsPanel,
  isHealthSettingsTab,
} from '@/components/health/health-settings-panel'
import { PageHeader } from '@/components/layout'
import { PageSkeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'

function AlertSettingsContent() {
  // Optional deep link into a specific tab: /alert-settings?tab=webhooks
  const search = useSearch({ strict: false }) as { tab?: string }
  const defaultTab = isHealthSettingsTab(search.tab) ? search.tab : undefined
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader
        title="Alert Settings"
        description="Thresholds, alert channels, webhooks, quiet hours, digests and alert history — stored locally in your browser"
      />
      <HealthSettingsPanel
        layout="page"
        defaultTab={defaultTab}
        footer={(save) => (
          <div className="flex justify-end border-t pt-4">
            <Button onClick={save}>Save</Button>
          </div>
        )}
      />
    </div>
  )
}

function AlertSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlertSettingsContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/alert-settings')({
  component: AlertSettingsPage,
})
