import { ArrowLeft, BarChart3 } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'

import { InsightsPreview } from '@/components/insights/insights-preview'
import { InsightsSettingsForm } from '@/components/insights/insights-settings-form'
import { StatsInsightsSettingsForm } from '@/components/insights/stats-insights-settings-form'
import { AppLink } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useHostId } from '@/lib/swr'
import { buildUrl } from '@/lib/url/url-builder'

/** Crisp four-axis sparkle mark — no gradient blob. */
function InsightsGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <line
        x1="8"
        y1="1"
        x2="8"
        y2="4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="8"
        y1="12"
        x2="8"
        y2="15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="1"
        y1="8"
        x2="4"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="8"
        x2="15"
        y2="8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="3"
        y1="3"
        x2="5.5"
        y2="5.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="10.5"
        y1="10.5"
        x2="13"
        y2="13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="13"
        y1="3"
        x2="10.5"
        y2="5.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="5.5"
        y1="10.5"
        x2="3"
        y2="13"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="1.75" fill="currentColor" />
    </svg>
  )
}

function InsightsSettingsPage() {
  const hostId = useHostId()

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-8">
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

        {/* Header — crisp mark, no gradient blob */}
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-foreground/70">
            <InsightsGlyph />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Insights settings
            </h1>
            <p className="text-muted-foreground text-sm">
              Configure how the dashboard analyzes this cluster.
            </p>
          </div>
        </div>
      </div>

      {/* AI Insights — model, prompt style, enrichment; settings left, live example right. */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <InsightsGlyph />
          <h2 className="text-sm font-medium text-foreground">AI Insights</h2>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1fr_minmax(320px,380px)]">
          <InsightsSettingsForm />
          <div className="lg:sticky lg:top-6 lg:self-start">
            <InsightsPreview hostId={hostId} autoRun />
          </div>
        </div>
      </section>

      <Separator />

      {/* Statistics Insights — anomaly overlays (moving-average band + absolute
          threshold) drawn on the statistical charts (/queries/insights, Cluster
          Statistics). These settings are consumed by the chart overlays. */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="text-sm font-medium text-foreground">
            Statistics Insights
          </h2>
        </div>
        <p className="text-muted-foreground text-xs">
          Anomaly detection overlays for the statistical charts — a
          moving-average band and an optional absolute threshold.
        </p>
        <StatsInsightsSettingsForm />
      </section>
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/insights-settings')({
  component: InsightsSettingsPage,
})
