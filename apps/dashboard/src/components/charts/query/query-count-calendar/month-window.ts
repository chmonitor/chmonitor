/**
 * Month-window sizing: how far back the calendar model builds, regrouping the
 * continuous week grid into per-month blocks, fitting those blocks to the
 * measured container width, and re-summarizing just the visible blocks.
 */

import type {
  CalendarDay,
  CalendarModel,
  CalendarStats,
  CalendarWeek,
} from './build-model'
import type { HeatmapDayRow, MetricConfig } from './metrics'

import { buildCalendarModel } from './build-model'
import { formatMonthYear, MONTH_NAMES } from './date-utils'

/**
 * Widest window the model ever builds, in calendar months (including the
 * current one). Wide screens can show more than a year of history; this caps
 * how far back the grid is built so ultrawide viewports stay bounded.
 */
export const MAX_WINDOW_MONTHS = 24

/**
 * First day of the model window: the start of the month `maxMonths - 1` months
 * before `today`. Empty months before the first data row still render so a
 * wide card fills its width; {@link pickVisibleMonthBlocks} then drops those
 * oldest months first when the viewport shrinks.
 */
export function resolveWindowStart(
  _rows: HeatmapDayRow[],
  today: Date,
  maxMonths = MAX_WINDOW_MONTHS
): Date {
  return new Date(
    today.getFullYear(),
    today.getMonth() - (Math.max(1, maxMonths) - 1),
    1,
    12
  )
}

/** ISO date of the oldest row, or null when there is no data. */
export function earliestRowIso(rows: HeatmapDayRow[]): string | null {
  let earliest: string | null = null
  for (const r of rows) {
    if (r.date && (earliest === null || r.date < earliest)) earliest = r.date
  }
  return earliest
}

/**
 * Build a calendar model spanning whole months, from {@link resolveWindowStart}
 * through the end of the current month. The renderer then trims the oldest
 * months that don't fit the measured container width
 * ({@link pickVisibleMonthBlocks}), so the number of months on screen follows
 * the available width instead of a fixed year.
 */
export function buildMonthWindowModel(
  rows: HeatmapDayRow[],
  today: Date,
  metric: MetricConfig,
  maxMonths = MAX_WINDOW_MONTHS
): CalendarModel {
  const start = resolveWindowStart(rows, today, maxMonths)
  return buildCalendarModel(rows, today, metric, 53, true, start)
}

/**
 * A month's worth of day cells, grouped out of the continuous week grid for the
 * "broken-down" year-calendar layout. Each `weeks` column keeps the Sunday-first
 * row alignment of {@link CalendarModel.weeks}, but days belonging to a
 * neighbouring month are masked to `null` so the block renders only its own
 * days (partial first/last weeks, exactly like a wall calendar).
 */
export interface MonthBlock {
  /** Stable key, `YYYY-M` (month 0-indexed). */
  key: string
  /** Short month name, e.g. "Jun". */
  label: string
  year: number
  /** Week columns touching this month, oldest → newest, masked to this month. */
  weeks: CalendarWeek[]
}

/**
 * Re-group a {@link CalendarModel}'s continuous week columns into per-month
 * blocks. A boundary week (one spanning two months) is emitted into both blocks,
 * masked to the relevant month each time — so every block shows its own partial
 * leading/trailing week. Pure derivation: no new date math, just a regrouping of
 * the already-built cells, keeping the tested {@link buildCalendarModel} intact.
 */
export function buildMonthBlocks(model: CalendarModel): MonthBlock[] {
  const blocks: MonthBlock[] = []
  const byKey = new Map<string, MonthBlock>()
  const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`

  for (const week of model.weeks) {
    // Distinct months this week touches, in chronological (Sun→Sat) order.
    const monthsInWeek: string[] = []
    for (const day of week) {
      if (day) {
        const k = keyOf(day.date)
        if (!monthsInWeek.includes(k)) monthsInWeek.push(k)
      }
    }

    for (const k of monthsInWeek) {
      let block = byKey.get(k)
      if (!block) {
        const sample = week.find((d) => d && keyOf(d.date) === k) as CalendarDay
        block = {
          key: k,
          label: MONTH_NAMES[sample.date.getMonth()],
          year: sample.date.getFullYear(),
          weeks: [],
        }
        byKey.set(k, block)
        blocks.push(block)
      }
      // Keep only this month's days in the column; others become gaps.
      block.weeks.push(
        week.map((day) => (day && keyOf(day.date) === k ? day : null))
      )
    }
  }

  return blocks
}

/** Pixel sizing of the heatmap grid, used to fit month blocks to a width. */
export interface MonthBlockSizing {
  /** Width of one week column incl. its gap (cell + inter-cell gap). */
  colPx?: number
  /** Horizontal gap between adjacent month blocks. */
  blockGapPx?: number
  /** Width of the leading weekday-label gutter. */
  gutterPx?: number
}

/**
 * Pick the trailing (most recent) month blocks that fit within `availableWidth`,
 * dropping the oldest first so the current month is always kept on screen. The
 * newest month is always included even if it alone exceeds the width. When the
 * width is unknown (≤ 0) only the newest month is kept — extra left months
 * are added after ResizeObserver measures the card, so we never flash a
 * year of empty padding before the first layout.
 */
export function pickVisibleMonthBlocks(
  blocks: MonthBlock[],
  availableWidth: number,
  sizing: MonthBlockSizing = {}
): MonthBlock[] {
  if (blocks.length === 0) return blocks
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return blocks.slice(-1)
  }

  const colPx = sizing.colPx ?? 13
  const blockGapPx = sizing.blockGapPx ?? 12
  const gutterPx = sizing.gutterPx ?? 24
  const widthOf = (b: MonthBlock) => b.weeks.length * colPx

  let used = gutterPx
  const visibleReversed: MonthBlock[] = []
  for (let i = blocks.length - 1; i >= 0; i--) {
    const needsGap = visibleReversed.length > 0
    const w = widthOf(blocks[i]) + (needsGap ? blockGapPx : 0)
    // Always keep the newest month; stop once an older one would overflow.
    if (needsGap && used + w > availableWidth) break
    used += w
    visibleReversed.push(blocks[i])
  }

  return visibleReversed.reverse()
}

/**
 * Recompute the aggregates over just the month blocks currently rendered, so
 * "over N days" / "of N (x%)" / the range caption / the colour scale all
 * describe the window the user actually sees. Future cells of the current month
 * render but never count. Days before `excludeBeforeIso` (left-side padding
 * months with no data) render as empty cells but do not inflate KPIs.
 * Every day appears in exactly one block (boundary weeks are masked per month),
 * so no de-duplication is needed.
 */
export function summarizeVisibleBlocks(
  blocks: MonthBlock[],
  excludeBeforeIso?: string | null
): CalendarStats {
  let max = 0
  let total = 0
  let activeDays = 0
  let totalDays = 0
  let peak: CalendarDay | null = null
  let firstDay: Date | null = null
  let lastDay: Date | null = null

  for (const block of blocks) {
    for (const week of block.weeks) {
      for (const day of week) {
        if (!day || day.isFuture) continue
        if (excludeBeforeIso && day.iso < excludeBeforeIso) continue
        if (!firstDay || day.date < firstDay) firstDay = day.date
        if (!lastDay || day.date > lastDay) lastDay = day.date
        totalDays += 1
        total += day.value
        if (day.value > 0) activeDays += 1
        if (day.value > max) max = day.value
        if (!peak || day.value > peak.value) peak = day
      }
    }
  }

  return {
    max,
    total,
    activeDays,
    totalDays,
    avgActive: activeDays > 0 ? total / activeDays : 0,
    peak,
    rangeLabel:
      firstDay && lastDay
        ? `${formatMonthYear(firstDay)} – ${formatMonthYear(lastDay)}`
        : '',
  }
}
