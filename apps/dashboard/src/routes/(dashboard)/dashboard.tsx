import { createFileRoute } from '@tanstack/react-router'

import type { NewWidgetInput } from '@/components/dashboard/add-widget-menu'
import type { DashboardLayout, DashboardWidget } from '@/types/dashboard-layout'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { hasChart } from '@/components/charts/registry'
import { AddWidgetMenu } from '@/components/dashboard/add-widget-menu'
import { ChartPicker } from '@/components/dashboard/chart-picker'
import { Grid } from '@/components/dashboard/grid'
import { SavedDashboardsToolbar } from '@/components/dashboard/saved-dashboards-toolbar'
import {
  DashboardTimeRangeProvider,
  dashboardDateRangeConfig,
  useDashboardTimeRange,
} from '@/components/dashboard/time-range-context'
import { DateRangeSelector } from '@/components/date-range'
import { ChartsOnlyPageSkeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { EmptyState } from '@/components/ui/empty-state'
import {
  DEFAULT_CHART_WIDGET_H,
  DEFAULT_CHART_WIDGET_W,
  findFreePosition,
  MIN_WIDGET_H,
  MIN_WIDGET_W,
  normalizeLayout,
} from '@/types/dashboard-layout'

/** Charts shown when no saved dashboard is loaded */
const DEFAULT_CHARTS: string[] = [
  'query-count',
  'query-duration',
  'query-memory',
  'failed-query-count',
  'merge-count',
  'memory-usage',
  'cpu-usage',
  'disk-size',
]

const SESSION_KEY = 'dashboard-current-layout'

function defaultLayout(): DashboardLayout {
  // normalizeLayout's legacy string[] path auto-places these 2-per-row,
  // matching the pre-plan-57 look.
  return normalizeLayout(DEFAULT_CHARTS)
}

function readInitialLayout(): DashboardLayout {
  if (typeof window === 'undefined') return defaultLayout()
  const stored = sessionStorage.getItem(SESSION_KEY)
  if (stored) {
    try {
      return normalizeLayout(JSON.parse(stored))
    } catch {
      // ignore — fall through to default
    }
  }
  return defaultLayout()
}

/** Default grid size for a newly added widget, per type. */
function defaultWidgetSize(type: DashboardWidget['type']): {
  w: number
  h: number
} {
  switch (type) {
    case 'chart':
      return { w: DEFAULT_CHART_WIDGET_W, h: DEFAULT_CHART_WIDGET_H }
    case 'table':
      return { w: 6, h: 5 }
    case 'stat':
      return { w: 3, h: MIN_WIDGET_H }
    case 'text':
      return { w: MIN_WIDGET_W + 2, h: MIN_WIDGET_H }
    default:
      return { w: MIN_WIDGET_W, h: MIN_WIDGET_H }
  }
}

/** Renders the shared dashboard date-range control driving every widget. */
function DashboardRangeSelector() {
  const { range, setRange } = useDashboardTimeRange()
  return (
    <DateRangeSelector
      config={dashboardDateRangeConfig}
      value={range.value}
      onChange={setRange}
      alwaysVisible
      className="h-8 rounded-md border px-2"
    />
  )
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: 'view' | 'arrange'
  onChange: (mode: 'view' | 'arrange') => void
}) {
  return (
    <ButtonGroup>
      <Button
        type="button"
        size="sm"
        variant={mode === 'view' ? 'secondary' : 'ghost'}
        onClick={() => onChange('view')}
        aria-pressed={mode === 'view'}
      >
        View
      </Button>
      <Button
        type="button"
        size="sm"
        variant={mode === 'arrange' ? 'secondary' : 'ghost'}
        onClick={() => onChange('arrange')}
        aria-pressed={mode === 'arrange'}
      >
        Arrange
      </Button>
    </ButtonGroup>
  )
}

function DashboardContent() {
  const [layout, setLayout] = useState<DashboardLayout>(readInitialLayout)
  const [mode, setMode] = useState<'view' | 'arrange'>('view')

  // Persist the current, unsaved layout to sessionStorage so it survives
  // navigation within the same tab but resets on new tab (same UX as
  // pre-plan-57 — saved dashboards use D1/localStorage for durable,
  // cross-tab persistence).
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(layout))
  }, [layout])

  const handleLoad = useCallback((loaded: DashboardLayout) => {
    setLayout(loaded)
  }, [])

  // Drop chart widgets referencing a chart no longer in the registry —
  // mirrors the pre-plan-57 `validCharts = selectedCharts.filter(hasChart)`.
  const visibleWidgets = layout.widgets.filter(
    (w) => w.type !== 'chart' || (w.chartName && hasChart(w.chartName))
  )
  const selectedChartNames = visibleWidgets
    .filter((w) => w.type === 'chart')
    .map((w) => w.chartName as string)

  // ChartPicker still operates purely on chart-name selection; adapt its
  // add/remove-by-name callback onto the widget layout (one 'chart' widget
  // per selected name), auto-placed via findFreePosition.
  const handleChartsChange = useCallback((names: string[]) => {
    setLayout((prev) => {
      const currentChartNames = new Set(
        prev.widgets.filter((w) => w.type === 'chart').map((w) => w.chartName)
      )
      const nextNames = new Set(names)
      const added = names.filter((n) => !currentChartNames.has(n))

      let widgets = prev.widgets.filter(
        (w) => w.type !== 'chart' || (w.chartName && nextNames.has(w.chartName))
      )

      for (const chartName of added) {
        const { w, h } = defaultWidgetSize('chart')
        const { x, y } = findFreePosition(widgets, w, h)
        widgets = [
          ...widgets,
          { id: crypto.randomUUID(), type: 'chart', chartName, x, y, w, h },
        ]
      }

      return { widgets }
    })
  }, [])

  const handleAddWidget = useCallback((input: NewWidgetInput) => {
    setLayout((prev) => {
      const { w, h } = defaultWidgetSize(input.type)
      const { x, y } = findFreePosition(prev.widgets, w, h)
      const widget: DashboardWidget = {
        id: crypto.randomUUID(),
        ...input,
        x,
        y,
        w,
        h,
      }
      return { widgets: [...prev.widgets, widget] }
    })
    setMode('arrange')
  }, [])

  const handleGridChange = useCallback((widgets: DashboardWidget[]) => {
    setLayout({ widgets })
  }, [])

  return (
    <DashboardTimeRangeProvider>
      <div className="flex flex-col gap-4">
        {/* Toolbar */}
        <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <SavedDashboardsToolbar layout={layout} onLoad={handleLoad} />
            <ChartPicker
              selectedCharts={selectedChartNames}
              onChange={handleChartsChange}
            />
            <AddWidgetMenu onAdd={handleAddWidget} />
          </div>
          <div className="flex items-center gap-2">
            <DashboardRangeSelector />
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
        </div>

        {/* Empty state */}
        {visibleWidgets.length === 0 && (
          <EmptyState
            variant="no-data"
            title="No widgets yet"
            description='Use "Add Charts" or "Add Widget" to build your dashboard.'
          />
        )}

        {/* Widget grid */}
        <Grid
          widgets={visibleWidgets}
          mode={mode}
          onChange={handleGridChange}
        />
      </div>
    </DashboardTimeRangeProvider>
  )
}

function DashboardPage() {
  return (
    <Suspense fallback={<ChartsOnlyPageSkeleton chartCount={8} />}>
      <DashboardContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/dashboard')({
  component: DashboardPage,
})
