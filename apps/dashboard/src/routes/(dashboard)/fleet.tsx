import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { FleetOverview } from '@/components/fleet/fleet-overview'
import { FleetTable } from '@/components/fleet/fleet-table'
import { FleetViewToggle } from '@/components/fleet/fleet-view-toggle'
import { useFleetView } from '@/components/fleet/use-fleet-view'
import { PageHeader } from '@/components/layout'
import { Skeleton } from '@/components/ui/skeleton'
import { pageOgHead } from '@/lib/og'

function FleetSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-44 w-full rounded-xl" />
      ))}
    </div>
  )
}

function FleetPage() {
  const [view, setView] = useFleetView()

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Fleet Overview"
        description="Health signals across all connected hosts in one view."
        actions={<FleetViewToggle value={view} onChange={setView} />}
      />
      <Suspense fallback={<FleetSkeleton />}>
        {view === 'table' ? <FleetTable /> : <FleetOverview />}
      </Suspense>
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/fleet')({
  component: FleetPage,
  head: () => pageOgHead('fleet'),
})
