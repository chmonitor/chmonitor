/**
 * Pure helpers for the GitHub-style "Activity Calendar" contribution heatmap.
 *
 * The backing query (`query-count-heatmap`) returns one row per calendar day
 * carrying several metrics (query volume, failures, peak memory, avg duration,
 * bytes written). These helpers bucket those rows into Sunday-first week
 * columns (matching GitHub) for a chosen {@link MetricConfig} and derive the
 * summary stats shown in the KPI strip.
 *
 * All logic here is timezone-naive on purpose: it operates on the date *strings*
 * ClickHouse returns and on a local "today" anchor, so it stays deterministic
 * and unit-testable.
 *
 * Barrel: re-exports every symbol from the split modules below so existing
 * `./query-count-calendar` import sites keep resolving unchanged.
 */

export type {
  CalendarDay,
  CalendarModel,
  CalendarStats,
  CalendarWeek,
} from './build-model'
export type {
  DayCell,
  HeatmapDayRow,
  MetricAggregation,
  MetricConfig,
  MetricKey,
} from './metrics'
export type { MonthBlock, MonthBlockSizing } from './month-window'
export type { StatCard } from './stat-cards'

export { buildCalendarModel } from './build-model'
export {
  CALENDAR_DAY_LABELS,
  formatCalendarDate,
  formatShortDate,
  isoDate,
} from './date-utils'
export {
  formatDurationMs,
  getIntensityClass,
  INTENSITY_TIERS,
  METRIC_CONFIGS,
  METRIC_ORDER,
  TIER_THRESHOLDS,
} from './metrics'
export {
  buildMonthBlocks,
  buildMonthWindowModel,
  earliestRowIso,
  MAX_WINDOW_MONTHS,
  pickVisibleMonthBlocks,
  resolveWindowStart,
  summarizeVisibleBlocks,
} from './month-window'
export { buildStatCards } from './stat-cards'
