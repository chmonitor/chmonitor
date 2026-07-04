import { createFileRoute } from '@tanstack/react-router'

import type { OverviewChartConfig } from './-charts-config'

import { OVERVIEW_TABS } from './-charts-config'
import { lazy, memo, Suspense, useMemo, useState } from 'react'
import { ClientOnly } from '@/components/client-only'
import { InsightsStrip } from '@/components/insights/insights-strip'
import { cardStyles } from '@/components/overview-charts/card-styles'
import { OverviewCharts } from '@/components/overview-charts/overview-charts-client'
import { OverviewStatusStrip } from '@/components/overview-charts/overview-status-strip'
import { ChartSkeleton, Skeleton, TabsSkeleton } from '@/components/skeletons'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSearchParams } from '@/lib/next-compat'
import { pageOgHead } from '@/lib/og'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

// Shared cluster-topology view — large SVG chunk, must not SSR. Reused as-is
// from the /clusters page so both surfaces render the same component.
const TopologyView = lazy(() =>
  import('@/components/cluster-topology').then((m) => ({
    default: m.TopologyView,
  }))
)

const VALID_TABS = new Set(OVERVIEW_TABS.map((tab) => tab.value))
const DEFAULT_TAB = 'overview'

/** Underline-active tab styling, overriding the shadcn pill defaults. */
const TAB_TRIGGER_CLASS = cn(
  // layout
  'h-auto flex-none px-3 py-2',
  // borders — bottom-only underline
  'rounded-none border-0 border-b-2 border-transparent bg-transparent shadow-none',
  // typography
  'text-[13px] font-medium text-muted-foreground',
  // states
  'transition-colors hover:text-foreground',
  'data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none',
  'dark:data-[state=active]:border-foreground dark:data-[state=active]:bg-transparent',
  // keyboard focus — inset ring stays inside the bottom-border strip
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
)

interface LazyTabContentProps {
  charts: OverviewChartConfig[]
  gridClassName: string
  label: string
  hostId: number
}

const OVERVIEW_CHART_CLASS_NAME = 'h-full min-h-0 w-full'
const OVERVIEW_CHART_CARD_CONTENT_CLASS_NAME =
  'flex min-h-0 flex-1 flex-col px-3 pb-3 pt-0'
// Full-width banner charts (e.g. the Activity Heatmap) size to their content
// instead of a fixed grid row, so the card content uses auto height (no flex-1
// / min-h-0 height cap that would clip the calendar).
const BANNER_CHART_CARD_CONTENT_CLASS_NAME = 'flex flex-col px-4 pb-4 pt-0'

const OverviewChart = memo(function OverviewChart({
  chartConfig,
  hostId,
  banner,
}: {
  chartConfig: OverviewChartConfig
  hostId: number
  banner: boolean
}) {
  const ChartComponent = chartConfig.component
  return (
    <ChartComponent
      title={chartConfig.title}
      interval={chartConfig.interval}
      lastHours={chartConfig.lastHours}
      className={chartConfig.className}
      chartClassName={cn(
        banner ? undefined : OVERVIEW_CHART_CLASS_NAME,
        chartConfig.chartClassName
      )}
      chartCardContentClassName={cn(
        banner
          ? BANNER_CHART_CARD_CONTENT_CLASS_NAME
          : OVERVIEW_CHART_CARD_CONTENT_CLASS_NAME,
        chartConfig.chartCardContentClassName
      )}
      hostId={hostId}
      href={chartConfig.href}
      {...(chartConfig.props ?? {})}
    />
  )
})

const LazyTabContent = function LazyTabContent({
  charts,
  gridClassName,
  label,
  hostId,
}: LazyTabContentProps) {
  // All charts mount immediately so each fires its own TanStack Query in
  // parallel on tab-mount (inactive tabs stay unmounted via Radix, so only the
  // active tab's charts fetch). By the time the user scrolls a chart into view
  // its query has already resolved and the result is cached, so scrolling
  // reveals ready content instead of a scroll-triggered skeleton. We do NOT
  // gate the mount on scroll: deferring the mount also defers the first fetch,
  // which is what made each card flash skeleton→content as it scrolled in.
  //
  // `fullWidth` charts render as their own auto-height banner rows ABOVE the
  // fixed-height grid so a tall hero card (the Activity Heatmap) isn't clipped.
  const banners = useMemo(
    () => charts.filter((chart) => chart.fullWidth),
    [charts]
  )
  const gridCharts = useMemo(
    () => charts.filter((chart) => !chart.fullWidth),
    [charts]
  )

  return (
    <div className="flex flex-col gap-3">
      {banners.map((chartConfig) => (
        <OverviewChart
          key={chartConfig.id}
          chartConfig={chartConfig}
          hostId={hostId}
          banner
        />
      ))}
      {gridCharts.length > 0 && (
        <div
          className={gridClassName}
          role="region"
          aria-label={`${label} charts`}
        >
          {gridCharts.map((chartConfig) => (
            <OverviewChart
              key={chartConfig.id}
              chartConfig={chartConfig}
              hostId={hostId}
              banner={false}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Per-tab loading fallback shown while a newly-visited tab's lazy chart chunks
 * load. Mirrors the tab's real grid (class + chart count) so the swap is
 * height-stable and only the tab region — not the whole page — shows skeletons.
 */
function TabContentSkeleton({ tab }: { tab: (typeof OVERVIEW_TABS)[number] }) {
  if (tab.customContent === 'topology') {
    return <Skeleton className="h-[420px] w-full rounded-lg" />
  }

  const banners = tab.charts.filter((chart) => chart.fullWidth)
  const gridCharts = tab.charts.filter((chart) => !chart.fullWidth)

  return (
    <div
      className="flex flex-col gap-3"
      role="status"
      aria-label={`Loading ${tab.label} charts`}
    >
      {banners.map((chart) => (
        <Skeleton key={chart.id} className="h-[440px] w-full rounded-lg" />
      ))}
      {gridCharts.length > 0 && (
        <div className={tab.gridClassName}>
          {gridCharts.map((chart) => (
            <ChartSkeleton
              key={chart.id}
              className={cn(OVERVIEW_CHART_CLASS_NAME, chart.className)}
              type={chart.type === 'metric' ? 'metric' : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function OverviewPageContent() {
  const hostId = useHostId()
  const searchParams = useSearchParams()

  // Active tab is LOCAL state (source of truth for rendering) seeded once from
  // the URL. We persist changes back to the URL via the History API rather than
  // reading the tab from `useSearchParams()` on every render — a router-driven
  // param read would re-suspend and flash the page fallback on each tab click.
  const [activeTab, setActiveTab] = useState<string>(() => {
    const tabParam = searchParams.get('tab')
    return tabParam && VALID_TABS.has(tabParam) ? tabParam : DEFAULT_TAB
  })

  const handleTabChange = (value: string) => {
    // Update URL with new tab value, preserving other params
    const params = new URLSearchParams(searchParams.toString())
    if (value === DEFAULT_TAB) {
      // Remove tab param if it's the default value (cleaner URL)
      params.delete('tab')
    } else {
      params.set('tab', value)
    }

    // Update the URL via the native History API rather than router.replace().
    // A router navigation refetches the route's RSC payload, which re-suspends
    // the searchParams boundary and flashes `OverviewPageFallback` (the 4 KPI
    // skeletons) on EVERY tab click — even though the cards' SWR data is cached.
    // History.replaceState updates `useSearchParams()` reactively with no
    // navigation, so only the (cached) tab content swaps in. Matches the pattern
    // in use-table-filters.ts / time-range-context.tsx.
    const qs = params.toString()
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    window.history.replaceState(window.history.state, '', newUrl)

    // Local state drives the active tab instantly (no navigation round-trip).
    setActiveTab(value)
  }

  return (
    <div>
      <OverviewStatusStrip className="mb-3" />
      <OverviewCharts className="mb-4 sm:mb-6" />

      <ClientOnly fallback={null}>
        <InsightsStrip hostId={hostId} className="mb-4 sm:mb-6" />
      </ClientOnly>

      <ClientOnly
        fallback={
          <TabsSkeleton tabCount={OVERVIEW_TABS.length} variant="underline" />
        }
      >
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="space-y-2"
        >
          <div className="scrollbar-hide overflow-x-auto pb-px">
            <TabsList className="inline-flex h-auto w-full items-center justify-start gap-1 rounded-none border-b border-border bg-transparent p-0 text-muted-foreground">
              {OVERVIEW_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className={TAB_TRIGGER_CLASS}
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {OVERVIEW_TABS.map((tab) => (
            <TabsContent
              key={tab.value}
              value={tab.value}
              className="space-y-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 ease-out"
            >
              {/*
                No forceMount: Radix unmounts inactive tab content, so hidden
                tabs stop polling their charts' refetchInterval (the project
                convention is to UNMOUNT hidden chart subtrees, not CSS-hide
                them). Revisiting a tab re-mounts it but TanStack Query's
                30-min gcTime serves the cached data instantly — no skeleton,
                no refetch. LOCAL Suspense per tab: the charts are React.lazy(),
                so a first-time visit suspends while its chunk loads. Without a
                boundary here that suspension bubbles to the page-level
                <Suspense> and flashes the FULL-PAGE skeleton (status strip +
                KPI cards + tab bar). Catching it locally swaps only the tab's
                chart region; everything outside the tab content stays mounted.
              */}
              <Suspense fallback={<TabContentSkeleton tab={tab} />}>
                {tab.customContent === 'topology' ? (
                  <TopologyView
                    hostId={hostId}
                    detailHref={`/clusters?host=${hostId}`}
                  />
                ) : (
                  <LazyTabContent
                    charts={tab.charts}
                    gridClassName={tab.gridClassName}
                    label={tab.label}
                    hostId={hostId}
                  />
                )}
              </Suspense>
            </TabsContent>
          ))}
        </Tabs>
      </ClientOnly>
    </div>
  )
}

// First (default) tab whose grid is shown on initial load. Reserving its real
// height in the fallback is what keeps the page scrollable while data loads.
const FIRST_TAB = OVERVIEW_TABS[0]

/**
 * Full-page loading fallback for the searchParams Suspense boundary.
 *
 * `OverviewPageContent` reads `useSearchParams()`/`useHostId()`, which Next.js
 * requires to sit under Suspense. A tiny single-card fallback collapses the
 * document to ~140px during that flash, so the scroll container has nothing to
 * scroll and the viewport snaps back to the top. Reserving the real layout's
 * height — status strip + KPI grid + tabs + the first tab's chart grid — keeps
 * the scroll position stable and lets the user scroll to the bottom while the
 * charts are still loading.
 */
function OverviewPageFallback() {
  return (
    <div>
      <Skeleton className="mb-3 h-5 w-full rounded-lg" />
      <div className="mb-4 grid auto-rows-fr grid-cols-1 gap-3 sm:mb-6 sm:gap-4 sm:grid-cols-2 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={cn(cardStyles.base, 'gap-2.5 p-3 sm:p-4')}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <TabsSkeleton tabCount={OVERVIEW_TABS.length} variant="underline" />
      {/* Reserve the first tab's banners + chart grid so the loading document is
          roughly as tall as the loaded page. Reuses TabContentSkeleton so the
          banner/grid split stays in sync if charts are added/removed. */}
      <div className="mt-2">
        <TabContentSkeleton tab={FIRST_TAB} />
      </div>
    </div>
  )
}

function OverviewPage() {
  return (
    <Suspense fallback={<OverviewPageFallback />}>
      <OverviewPageContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/overview')({
  component: OverviewPage,
  head: () => pageOgHead('overview'),
})
