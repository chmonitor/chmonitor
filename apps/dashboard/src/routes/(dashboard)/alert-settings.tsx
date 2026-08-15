import { BellRing } from 'lucide-react'
import { createFileRoute, useSearch } from '@tanstack/react-router'

import { Suspense } from 'react'
import { AlertSettingsHero } from '@/components/health/alert-settings-hero'
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
  const defaultTab = isHealthSettingsTab(search.tab) ? search.tab : 'alerts'
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:gap-4">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <BellRing
              className="size-5 text-muted-foreground"
              strokeWidth={1.5}
            />
            Alert Settings
          </span>
        }
        description="Where alerts go, when they fire, and what has fired recently — start from a template, then tune anything"
      />
      <AlertSettingsHero />
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
