/**
 * Pure helpers for the "Activity Calendar" contribution heatmap: bucket the
 * per-day rows of `query-count-heatmap` into Sunday-first week columns for a
 * chosen {@link MetricConfig} and derive the KPI strip stats.
 *
 * Timezone-naive on purpose: it works on the date strings ClickHouse returns
 * and a local "today" anchor, so it stays deterministic and unit-testable.
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
