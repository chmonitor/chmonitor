import { BarChart3 } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLayout } from '@/components/layout/query-page'
import { useIsTableAvailable } from '@/components/menu/hooks/use-table-availability'
import { PageSkeleton } from '@/components/skeletons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { EVENTS_TABLE } from '@/lib/app-tables'
import { pageViewsConfig } from '@/lib/query-config/more/page-views'
import { useHostId } from '@/lib/swr'

/**
 * Shown when the `monitoring_events` tracking table is absent on the current
 * host (e.g. the read-only public demo). Page Views is self-analytics: it
 * records views of the chmonitor dashboard itself into an app-owned table on
 * the connected ClickHouse host — it does not read your cluster's data. The
 * menu item dims via the same table-availability check; this explains why
 * rather than dropping the user onto a raw "table not found" error.
 */
function PageViewsUnavailable() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <BarChart3 className="size-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold">
              Page Views is not set up
            </h2>
            <p className="text-sm text-muted-foreground">
              Self-analytics for the chmonitor dashboard itself
            </p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Page Views records visits to the chmonitor dashboard into a{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {EVENTS_TABLE}
          </code>{' '}
          table on this ClickHouse host. That table doesn't exist here yet, so
          there's nothing to show. It is separate from your cluster's data — it
          only tracks usage of this dashboard.
        </p>

        <Alert>
          <AlertTitle>Enable it</AlertTitle>
          <AlertDescription className="text-xs">
            Sign in with a ClickHouse user that has <code>CREATE TABLE</code>{' '}
            (and <code>INSERT</code>) rights and call{' '}
            <code className="font-mono">POST /api/init?hostId=&lt;n&gt;</code>{' '}
            once to create the table. After that, dashboard views are recorded
            automatically. On a read-only host — such as the public demo — this
            stays unavailable by design.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  )
}

function PageViewsPageContent() {
  const hostId = useHostId()
  const { available, isLoading } = useIsTableAvailable(EVENTS_TABLE, hostId)

  if (isLoading) return <PageSkeleton />
  if (!available) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Page Views"
          description="Usage analytics for the chmonitor dashboard"
        />
        <PageViewsUnavailable />
      </div>
    )
  }

  return <PageLayout queryConfig={pageViewsConfig} title="Page Views" />
}

function PageViewsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PageViewsPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/page-views')({
  component: PageViewsPage,
})
