import { createFileRoute, useSearch } from '@tanstack/react-router'

import { Suspense } from 'react'
import { HealthGrid } from '@/components/health/health-grid'
import { HealthSettingsDialog } from '@/components/health/health-settings-dialog'
import { PageHeader } from '@/components/layout'
import { ChartsOnlyPageSkeleton } from '@/components/skeletons'

function HealthPageContent() {
  // Deep link from the sidebar's "Alert Settings" item: /health?settings=alerts
  // mounts the page with the settings dialog already open.
  const search = useSearch({ strict: false }) as { settings?: string }
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader
        title="Health Summary"
        description="Real-time health indicators for your ClickHouse cluster"
        actions={
          <HealthSettingsDialog defaultOpen={search.settings === 'alerts'} />
        }
      />
      <HealthGrid />
    </div>
  )
}

function HealthPage() {
  return (
    <Suspense fallback={<ChartsOnlyPageSkeleton chartCount={8} />}>
      <HealthPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/health')({
  component: HealthPage,
})
