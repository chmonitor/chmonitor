/**
 * Bucket per-day metric rows into the Sunday-first week grid (GitHub-style
 * contribution calendar) and derive the aggregate stats for the KPI strip.
 */

import { isoDate, MONTH_NAMES, formatMonthYear } from './date-utils'
import type { HeatmapDayRow, MetricConfig } from './metrics'

/** A single day cell once placed in the calendar grid. */
export interface CalendarDay {
  iso: string
  date: Date
  /** The selected metric's value for this day. */
  value: number
  /** Pre-formatted value for tooltips/labels. */
  readable: string
  /**
   * Day falls after "today" — rendered dimmed/disabled so the current month
   * shows in full, but excluded from every stat. Only set when the model is
   * built with `includeFuture`.
   */
  isFuture?: boolean
}

/** A week column: 7 slots indexed by day-of-week (0 = Sunday). `null` marks a
 *  slot outside the rendered range (e.g. future days in the final column). */
export type CalendarWeek = (CalendarDay | null)[]

/**
 * Aggregates over a set of day cells. Produced either for the whole model
 * ({@link buildCalendarModel}) or for just the months currently on screen
 * (`summarizeVisibleBlocks`), so the KPI strip always describes exactly
 * what the user can see.
 */
export interface CalendarStats {
  max: number
  total: number
  activeDays: number
  totalDays: number
  avgActive: number
  peak: CalendarDay | null
  /** Caption like "Jun 2025 – Jun 2026", or '' when there are no days. */
  rangeLabel: string
}

export interface CalendarModel extends CalendarStats {
  /** Week columns, oldest → newest (left → right). */
  weeks: CalendarWeek[]
  /** Month label per week column, or `null` when the month is unchanged. */
  monthLabels: (string | null)[]
}

/**
 * Bucket per-day metric values into Sunday-first week columns spanning the
 * `weeksBack` weeks ending at `today`, for the chosen `metric`. The first column
 * is snapped back to a Sunday so each column is a clean week; future slots in
 * the last column are left `null`.
 */
export function buildCalendarModel(
  rows: HeatmapDayRow[],
  today: Date,
  metric: MetricConfig,
  weeksBack = 53,
  includeFuture = false,
  /**
   * Explicit first day of the window (overrides `weeksBack`). The grid is still
   * snapped back to the enclosing Sunday, but days before this date are left
   * empty so the oldest month block is never a partial month.
   */
  startOverride?: Date
): CalendarModel {
  const byDate = new Map<string, HeatmapDayRow>()
  for (const r of rows) byDate.set(r.date, r)

  // Anchor at noon to avoid DST edge cases when stepping days.
  const todayNoon = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    12
  )
  // When `includeFuture`, render through the end of the current month so it
  // shows in full (future days are dimmed + excluded from stats). Otherwise the
  // grid stops at today, matching GitHub's partial trailing week.
  const end = includeFuture
    ? new Date(today.getFullYear(), today.getMonth() + 1, 0, 12)
    : todayNoon
  // First day that may render. With `startOverride` this is a month boundary;
  // otherwise the day `weeksBack` weeks before today.
  const firstRenderable = startOverride
    ? new Date(
        startOverride.getFullYear(),
        startOverride.getMonth(),
        startOverride.getDate(),
        12
      )
    : (() => {
        const d = new Date(todayNoon)
        d.setDate(d.getDate() - (weeksBack * 7 - 1))
        return d
      })()
  const start = new Date(firstRenderable)
  // Snap to the Sunday on/before the start so columns are whole weeks.
  start.setDate(start.getDate() - start.getDay())

  const weeks: CalendarWeek[] = []
  const monthLabels: (string | null)[] = []
  let max = 0
  let total = 0
  let activeDays = 0
  let totalDays = 0
  let peak: CalendarDay | null = null
  let prevMonth = -1
  let firstDay: Date | null = null
  let lastDay: Date | null = null

  const cursor = new Date(start)
  while (cursor <= end) {
    const week: CalendarWeek = new Array(7).fill(null)
    let label: string | null = null

    for (let dow = 0; dow < 7; dow++) {
      // Future days (beyond today) stay null so the trailing column matches
      // GitHub: the current week is partially filled.
      if (cursor > end) {
        cursor.setDate(cursor.getDate() + 1)
        continue
      }
      // Leading days of the Sunday-snap that fall before the window start stay
      // null, so the oldest month block only ever shows its own days.
      if (startOverride && cursor < firstRenderable) {
        cursor.setDate(cursor.getDate() + 1)
        continue
      }

      const iso = isoDate(cursor)
      const isFuture = cursor > todayNoon
      const rec = byDate.get(iso)
      const value = rec ? metric.getValue(rec) : 0
      const day: CalendarDay = {
        iso,
        date: new Date(cursor),
        value,
        readable: metric.format(value),
        isFuture: isFuture || undefined,
      }
      week[dow] = day

      // Future days render (dimmed) for a full current month but never count
      // toward totals, peak, or the date-range caption.
      if (!isFuture) {
        if (!firstDay) firstDay = day.date
        lastDay = day.date

        totalDays += 1
        total += value
        if (value > 0) activeDays += 1
        if (value > max) max = value
        if (!peak || value > peak.value) peak = day
      }

      // Label the column at the first day that opens a new month.
      const month = cursor.getMonth()
      if (label === null && month !== prevMonth) {
        label = MONTH_NAMES[month]
        prevMonth = month
      }

      cursor.setDate(cursor.getDate() + 1)
    }

    weeks.push(week)
    monthLabels.push(label)
  }

  const rangeLabel =
    firstDay && lastDay
      ? `${formatMonthYear(firstDay)} – ${formatMonthYear(lastDay)}`
      : ''

  return {
    weeks,
    monthLabels,
    max,
    total,
    activeDays,
    totalDays,
    avgActive: activeDays > 0 ? total / activeDays : 0,
    peak,
    rangeLabel,
  }
}
