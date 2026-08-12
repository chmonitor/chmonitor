/**
 * Timezone-naive date/label helpers shared across the calendar model, month
 * windowing, and stat-card builders. All logic here operates on local dates
 * on purpose so it stays deterministic and unit-testable.
 */

const MONTH_NAMES_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

const WEEKDAY_NAMES_SHORT = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const

/** Day labels for the left gutter (Sunday-first, GitHub convention). */
export const CALENDAR_DAY_LABELS = WEEKDAY_NAMES_SHORT

/** Short month names, indexed by `Date#getMonth()`. */
export const MONTH_NAMES = MONTH_NAMES_SHORT

/** Short weekday names, indexed by `Date#getDay()`. */
export const WEEKDAY_NAMES = WEEKDAY_NAMES_SHORT

/** Format a Date as a local `YYYY-MM-DD` string (no UTC shift). */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Human-readable label for a day's tooltip, e.g. "Mon, Jun 17 2026". */
export function formatCalendarDate(d: Date): string {
  return `${WEEKDAY_NAMES_SHORT[d.getDay()]}, ${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`
}

/** Compact day label for KPI sublabels, e.g. "Jun 1". */
export function formatShortDate(d: Date): string {
  return `${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getDate()}`
}

/** "Mon YYYY" for the date-range caption. */
export function formatMonthYear(d: Date): string {
  return `${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getFullYear()}`
}
