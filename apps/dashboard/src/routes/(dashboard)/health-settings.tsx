import { HeartPulse } from 'lucide-react'
import { createFileRoute, useSearch } from '@tanstack/react-router'

import { Suspense } from 'react'
import {
  HealthSettingsPanel,
  isHealthSettingsTab,
} from '@/components/health/health-settings-panel'
import { PageHeader } from '@/components/layout'
import { PageSkeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'

function HealthSettingsContent() {
  // Optional deep link into a specific tab: /health-settings?tab=alerts
  const search = useSearch({ strict: false }) as { tab?: string }
  const defaultTab = isHealthSettingsTab(search.tab) ? search.tab : undefined
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:gap-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <HeartPulse
              className="size-5 text-muted-foreground"
              strokeWidth={1.5}
            />
            Health Settings
          </span>
        }
        description="Per-check warning and critical thresholds plus alert delivery — stored locally in your browser"
      />
      <HealthSettingsPanel
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

function HealthSettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HealthSettingsContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/health-settings')({
  component: HealthSettingsPage,
})
