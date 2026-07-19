/**
 * Report Settings — /report-settings (#2783 / #2790)
 *
 * Configure scheduled cluster health reports (cadence + covered hosts), and
 * try the pipeline immediately: "Generate now" opens a fresh HTML report,
 * "Send test report" delivers one through the configured alert channels.
 */

import { ArrowLeft, CalendarClock } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { ReportSettingsPanel } from '@/components/reports/report-settings-panel'
import { PageSkeleton } from '@/components/skeletons'
import { AppLink } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { pageOgHead } from '@/lib/og'
import { useHostId } from '@/lib/swr'
import { buildUrl } from '@/lib/url/url-builder'

function ReportSettingsPage() {
  const hostId = useHostId()

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-8">
      <div className="space-y-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground -ml-2 h-7 gap-1.5"
          render={<AppLink href={buildUrl('/overview', { host: hostId })} />}
        >
          <ArrowLeft className="size-3.5" />
          Back to overview
        </Button>

        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-foreground/70">
            <CalendarClock className="size-4" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Scheduled reports</h1>
            <p className="text-sm text-muted-foreground">
              Weekly or monthly cluster health reports, delivered to your alert
              channels
            </p>
          </div>
        </div>
      </div>

      <ReportSettingsPanel />
    </div>
  )
}

function ReportSettingsRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReportSettingsPage />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/report-settings')({
  component: ReportSettingsRoute,
  head: () => pageOgHead('report-settings'),
})
