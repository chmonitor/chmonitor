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
 */

import { formatCompactNumber, formatReadableSize } from '@/lib/format-readable'

/** One row of the per-day heatmap payload (all metrics for a single day). */
export interface HeatmapDayRow {
  date: string // 'YYYY-MM-DD'
  query_count: number
  failed_count: number
  memory_peak: number // bytes
  avg_duration_ms: number // milliseconds
  written_bytes: number // bytes
}

/** Backwards-compatible alias used by older imports. */
export type DayCell = HeatmapDayRow

/** Identifier for a heatmap metric / display mode. */
export type MetricKey = 'queries' | 'failed' | 'memory' | 'duration' | 'written'

/**
 * How a metric aggregates across days:
 * - `sum`: a daily volume that adds up (queries, failures, bytes written).
 * - `gauge`: a daily reading that does not sum (peak memory, avg duration).
 */
export type MetricAggregation = 'sum' | 'gauge'

export interface MetricConfig {
  key: MetricKey
  /** Pill + heading label, e.g. "Query Count". */
  label: string
  /** Aggregation behaviour, drives which KPI cards are shown. */
  aggregation: MetricAggregation
  /** Pull this metric's numeric value out of a day row. */
  getValue: (row: HeatmapDayRow) => number
  /** Format a value for KPIs / tooltips, e.g. 13247 → "13.2K". */
  format: (value: number) => string
  /**
   * Tailwind background classes, low → high. Tier 0 is the empty/no-activity
   * cell. Six entries: one empty tier + five intensity tiers. Class strings are
   * written out in full so Tailwind's JIT can see (and emit) them.
   */
  tiers: readonly [string, string, string, string, string, string]
  /** Accent text class for the highlighted ("peak") KPI value + legend. */
  accentText: string
  /** Accent background class for the active-mode dot / legend swatch. */
  accentDot: string
}

/** Format milliseconds as a compact human duration ("420ms", "1.8s", "18s"). */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`
}

/**
 * Metric definitions, in display order. Each entry is fully self-describing so
 * the component stays a thin renderer over the chosen config.
 */
export const METRIC_CONFIGS: Record<MetricKey, MetricConfig> = {
  queries: {
    key: 'queries',
    label: 'Query Count',
    aggregation: 'sum',
    getValue: (r) => r.query_count ?? 0,
    format: formatCompactNumber,
    // Keeps the existing chart-2 accent so the default mode matches the other
    // query charts across the dashboard.
    tiers: [
      'bg-muted/50',
      'bg-chart-2/20',
      'bg-chart-2/40',
      'bg-chart-2/60',
      'bg-chart-2/80',
      'bg-chart-2',
    ],
    accentText: 'text-chart-2',
    accentDot: 'bg-chart-2',
  },
  failed: {
    key: 'failed',
    label: 'Failed Queries',
    aggregation: 'sum',
    getValue: (r) => r.failed_count ?? 0,
    format: formatCompactNumber,
    tiers: [
      'bg-muted/50',
      'bg-rose-500/20',
      'bg-rose-500/40',
      'bg-rose-500/60',
      'bg-rose-500/80',
      'bg-rose-500',
    ],
    accentText: 'text-rose-500',
    accentDot: 'bg-rose-500',
  },
  memory: {
    key: 'memory',
    label: 'Memory Peak',
    aggregation: 'gauge',
    getValue: (r) => r.memory_peak ?? 0,
    format: (v) => formatReadableSize(v),
    tiers: [
      'bg-muted/50',
      'bg-amber-500/20',
      'bg-amber-500/40',
      'bg-amber-500/60',
      'bg-amber-500/80',
      'bg-amber-500',
    ],
    accentText: 'text-amber-600 dark:text-amber-500',
    accentDot: 'bg-amber-500',
  },
  duration: {
    key: 'duration',
    label: 'Avg Duration',
    aggregation: 'gauge',
    getValue: (r) => r.avg_duration_ms ?? 0,
    format: formatDurationMs,
    tiers: [
      'bg-muted/50',
      'bg-violet-500/20',
      'bg-violet-500/40',
      'bg-violet-500/60',
      'bg-violet-500/80',
      'bg-violet-500',
    ],
    accentText: 'text-violet-500',
    accentDot: 'bg-violet-500',
  },
  written: {
    key: 'written',
    label: 'Data Written',
    aggregation: 'sum',
    getValue: (r) => r.written_bytes ?? 0,
    format: (v) => formatReadableSize(v),
    tiers: [
      'bg-muted/50',
      'bg-emerald-500/20',
      'bg-emerald-500/40',
      'bg-emerald-500/60',
      'bg-emerald-500/80',
      'bg-emerald-500',
    ],
    accentText: 'text-emerald-600 dark:text-emerald-500',
    accentDot: 'bg-emerald-500',
  },
}

/** Metric configs in the order their switch pills should appear. */
export const METRIC_ORDER: MetricKey[] = [
  'queries',
  'failed',
  'memory',
  'duration',
  'written',
]

/**
 * Default intensity ramp (query mode). Exported for the legend fallback and for
 * back-compat with existing tests. Tier 0 is empty / no-activity.
 */
export const INTENSITY_TIERS = METRIC_CONFIGS.queries.tiers

// Ratio (value / max) at or above which a cell takes the matching tier.
export const TIER_THRESHOLDS = [0, 0.01, 0.25, 0.5, 0.75] as const

/**
 * Map an absolute value to a Tailwind background class for its intensity within
 * the given tier ramp (defaults to the query ramp).
 */
export function getIntensityClass(
  value: number,
  max: number,
  tiers: readonly string[] = INTENSITY_TIERS
): string {
  if (max <= 0 || value <= 0) return tiers[0]
  const ratio = value / max
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    if (ratio >= TIER_THRESHOLDS[i]) return tiers[i + 1]
  }
  return tiers[0]
}

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
function formatMonthYear(d: Date): string {
  return `${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

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
 * ({@link summarizeVisibleBlocks}), so the KPI strip always describes exactly
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
        label = MONTH_NAMES_SHORT[month]
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

/**
 * Widest window the model ever builds, in calendar months (including the
 * current one). Wide screens can show more than a year of history; this caps
 * how far back the grid is built so ultrawide viewports stay bounded.
 */
export const MAX_WINDOW_MONTHS = 24

/**
 * First day of the model window: the start of the month `maxMonths - 1` months
 * before `today`, but never earlier than the month of the oldest row we have.
 * Capping at data coverage keeps a wide screen from rendering a year of empty
 * cells for a deployment with a short `query_log` TTL.
 */
export function resolveWindowStart(
  rows: HeatmapDayRow[],
  today: Date,
  maxMonths = MAX_WINDOW_MONTHS
): Date {
  const capStart = new Date(
    today.getFullYear(),
    today.getMonth() - (Math.max(1, maxMonths) - 1),
    1,
    12
  )
  let earliest: string | null = null
  for (const r of rows) {
    if (r.date && (earliest === null || r.date < earliest)) earliest = r.date
  }
  if (!earliest) return capStart
  const [y, m] = earliest.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m)) return capStart
  const dataStart = new Date(y, m - 1, 1, 12)
  return dataStart > capStart ? dataStart : capStart
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
          label: MONTH_NAMES_SHORT[sample.date.getMonth()],
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
 * newest month is always included even if it alone exceeds the width. Returns
 * all blocks unchanged when the width is unknown (≤ 0), so the caller can fall
 * back to horizontal scrolling before it has measured its container.
 */
export function pickVisibleMonthBlocks(
  blocks: MonthBlock[],
  availableWidth: number,
  sizing: MonthBlockSizing = {}
): MonthBlock[] {
  if (blocks.length === 0) return blocks
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return blocks

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
 * render but never count. Every day appears in exactly one block (boundary
 * weeks are masked per month), so no de-duplication is needed.
 */
export function summarizeVisibleBlocks(blocks: MonthBlock[]): CalendarStats {
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

/** A single KPI/stat card shown above the calendar. */
export interface StatCard {
  label: string
  value: string
  sub?: string
  /** Highlight the value with the metric accent colour (used for the peak). */
  accent?: boolean
}

/**
 * Build the four KPI cards for a metric + model. `sum` metrics lead with a
 * grand total; `gauge` metrics lead with the peak reading (a sum would be
 * meaningless for e.g. peak memory).
 */
export function buildStatCards(
  metric: MetricConfig,
  model: CalendarStats
): StatCard[] {
  const { total, max, activeDays, totalDays, avgActive, peak } = model
  const hasTraffic = max > 0
  const pct = totalDays > 0 ? Math.round((activeDays * 100) / totalDays) : 0
  const peakDate = peak && hasTraffic ? formatShortDate(peak.date) : '—'

  if (metric.aggregation === 'gauge') {
    return [
      {
        label: `Peak ${metric.label.split(' ')[0]}`,
        value: hasTraffic ? metric.format(max) : '—',
        sub: 'highest daily reading',
        accent: true,
      },
      {
        label: 'Average',
        value: hasTraffic ? metric.format(avgActive) : '—',
        sub: 'across active days',
      },
      {
        label: 'Busiest day',
        value: peakDate,
        sub: hasTraffic ? 'when the peak occurred' : undefined,
      },
      {
        label: 'Active days',
        value: formatCompactNumber(activeDays),
        sub: `of ${totalDays} (${pct}%)`,
      },
    ]
  }

  // sum metrics — vary the wording per metric so the cards read naturally.
  const wording: Record<
    'queries' | 'failed' | 'written',
    { total: string; peak: string; active: string; avgNoun: string }
  > = {
    queries: {
      total: 'Total queries',
      peak: 'Busiest day',
      active: 'Active days',
      avgNoun: 'queries per active day',
    },
    failed: {
      total: 'Total failed',
      peak: 'Worst day',
      active: 'Days with errors',
      avgNoun: 'errors per active day',
    },
    written: {
      total: 'Total written',
      peak: 'Biggest day',
      active: 'Active days',
      avgNoun: 'per active day',
    },
  }
  const w = wording[metric.key as 'queries' | 'failed' | 'written']

  return [
    {
      label: w.total,
      value: metric.format(total),
      sub: `over ${totalDays} days`,
    },
    {
      label: w.peak,
      value: hasTraffic ? metric.format(max) : '—',
      sub: hasTraffic ? `${peakDate} · peak daily volume` : undefined,
      accent: true,
    },
    {
      label: w.active,
      value: formatCompactNumber(activeDays),
      sub: `of ${totalDays} (${pct}%)`,
    },
    {
      label: 'Avg / active day',
      value: hasTraffic ? metric.format(avgActive) : '—',
      sub: w.avgNoun,
    },
  ]
}
