import { BarChart3 } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'

import { Suspense } from 'react'
import { getChartComponent, hasChart } from '@/components/charts/chart-registry'
import { ChartSkeleton, ChartsOnlyPageSkeleton } from '@/components/skeletons'
import { AppLink as Link } from '@/components/ui/app-link'
import { EmptyState } from '@/components/ui/empty-state'
import { useSearchParams } from '@/lib/next-compat'
import { useHostId } from '@/lib/swr'
import { buildUrl } from '@/lib/url/url-builder'

// A small, curated set of charts spanning query / system / merge / table
// categories, surfaced as quick picks when no ?name= is set.
const FEATURED_CHARTS = [
  'query-count',
  'query-duration',
  'memory-usage',
  'cpu-usage',
  'disk-size',
  'merge-count',
] as const

function formatChartLabel(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

interface DynamicChartProps {
  chartName: string
  hostId: number
}

function DynamicChart({ chartName, hostId }: DynamicChartProps) {
  // Check if chart exists in registry
  if (!hasChart(chartName)) {
    return null
  }

  const ChartComponent = getChartComponent(chartName)

  if (!ChartComponent) {
    return null
  }

  return (
    <Suspense fallback={<ChartSkeleton />}>
      <ChartComponent
        className="mb-4 w-full p-0"
        chartClassName="h-full min-h-[260px] sm:min-h-[300px]"
        hostId={hostId}
      />
    </Suspense>
  )
}

function ChartsPageContent() {
  const hostId = useHostId()
  const searchParams = useSearchParams()

  // Get chart names from URL search params
  const chartNames: string[] = (() => {
    const chartsParam = searchParams.get('name')
    if (!chartsParam) return []
    return decodeURIComponent(chartsParam).split(',')
  })()

  if (chartNames.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-16">
        <EmptyState
          variant="no-data"
          title="Select a chart to view"
          description="Choose from the charts below to visualize your ClickHouse metrics."
          icon={
            <BarChart3
              className="h-10 w-10 text-muted-foreground/60"
              strokeWidth={1.5}
            />
          }
          className="py-0"
        />
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {FEATURED_CHARTS.map((chartName) => (
            <Link
              key={chartName}
              href={buildUrl('/charts', { name: chartName }, searchParams)}
              className="inline-flex items-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {formatChartLabel(chartName)}
            </Link>
          ))}
        </div>
      </div>
    )
  }

  // Format chart names for display
  const displayTitle =
    chartNames.length === 1
      ? chartNames[0]
          .split('-')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ')
      : `${chartNames.length} Charts`

  return (
    <div className="max-w-full px-3 sm:px-0">
      <h1 className="mb-4 text-lg font-semibold sm:text-xl">{displayTitle}</h1>
      {chartNames.map((chartName, index) => (
        <DynamicChart
          key={`${chartName}-${index}`}
          chartName={chartName}
          hostId={hostId}
        />
      ))}
    </div>
  )
}

function ChartsPage() {
  return (
    <Suspense fallback={<ChartsOnlyPageSkeleton chartCount={4} />}>
      <ChartsPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/charts')({
  component: ChartsPage,
})
