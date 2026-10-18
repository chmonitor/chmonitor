import { createFileRoute, Outlet } from '@tanstack/react-router'

import { FirstRunGate } from '@/components/host/first-run-gate'
import { DashboardShell } from '@/components/layout/dashboard-shell'

// Pathless `(dashboard)` group: shared app chrome (sidebar + header +
// breadcrumb + floating agent) around the routed page, gated by FirstRunGate.
export const Route = createFileRoute('/(dashboard)')({
  component: DashboardLayout,
})

function DashboardLayout() {
  return (
    <DashboardShell>
      <FirstRunGate>
        <Outlet />
      </FirstRunGate>
    </DashboardShell>
  )
}
