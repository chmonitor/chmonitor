/**
 * Dashboard-scoped shared time range (plan 57).
 *
 * Distinct from the app-wide `useTimeRange()` (`@/lib/context/time-range-context`,
 * mounted once in `__root.tsx` and used as the fallback for every registry
 * chart's `lastHours`/`interval` when a chart receives no explicit prop —
 * see `create-area-chart.tsx` / `create-bar-chart.tsx`). This context is
 * scoped to a single dashboard page: `widget-chart.tsx` reads it and passes
 * `lastHours`/`interval` down as EXPLICIT props to the rendered chart, which
 * outranks the global context in that priority chain
 * (`rangeOverride ?? explicit prop ?? global context ?? factory default`).
 * That means one `DateRangeSelector` in the dashboard toolbar drives every
 * chart widget's baseline range, while each widget's own built-in
 * per-card date-range control (when its chart type has one) can still
 * locally override just that widget — the same override relationship the
 * global picker already has with per-chart controls elsewhere in the app.
 */

import type { ReactNode } from 'react'
import type { DateRangeValue } from '@/components/date-range'

import { createContext, use, useMemo } from 'react'
import { resolveDateRangeConfig, useDateRange } from '@/components/date-range'

const DASHBOARD_DATE_RANGE_CONFIG = resolveDateRangeConfig('standard')

interface DashboardTimeRangeContextValue {
  /** Current lastHours (undefined = "all" range). */
  lastHours?: number
  /** Current ClickHouse interval. */
  interval: DateRangeValue['interval']
  /** Full current range value, for the `DateRangeSelector`. */
  range: DateRangeValue
  /** Update the shared range. */
  setRange: (range: DateRangeValue) => void
}

const DashboardTimeRangeContext =
  createContext<DashboardTimeRangeContextValue | null>(null)

export function DashboardTimeRangeProvider({
  children,
}: {
  children: ReactNode
}) {
  // `useDateRange`'s standalone `lastHours`/`interval` fields are typed as
  // plain `string`/`number` for its own generality; `range` (a full
  // `DateRangeValue`) already carries the precise `ClickHouseInterval`
  // type, so read from it instead of re-declaring the loosened shape here.
  const { range, setRange } = useDateRange({
    config: DASHBOARD_DATE_RANGE_CONFIG,
  })

  const value = useMemo<DashboardTimeRangeContextValue>(
    () => ({
      lastHours: range.lastHours,
      interval: range.interval,
      range,
      setRange,
    }),
    [range, setRange]
  )

  return (
    <DashboardTimeRangeContext value={value}>
      {children}
    </DashboardTimeRangeContext>
  )
}

/** The dashboard grid's config, exported for the toolbar's `DateRangeSelector`. */
export const dashboardDateRangeConfig = DASHBOARD_DATE_RANGE_CONFIG

/**
 * Read the shared dashboard time range. Must be used within a
 * `DashboardTimeRangeProvider` (the dashboard route always wraps the grid in
 * one) — throws with a clear message rather than silently falling back, so
 * a widget added outside the provider fails loudly during development.
 */
export function useDashboardTimeRange(): DashboardTimeRangeContextValue {
  const ctx = use(DashboardTimeRangeContext)
  if (!ctx) {
    throw new Error(
      'useDashboardTimeRange must be used within a DashboardTimeRangeProvider'
    )
  }
  return ctx
}
