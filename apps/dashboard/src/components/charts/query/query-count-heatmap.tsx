import {
  ActivityIcon,
  ArrowUpRightIcon,
  CircleAlertIcon,
  HardDriveIcon,
  type LucideIcon,
  MemoryStickIcon,
  TimerIcon,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'

import type {
  CalendarDay,
  HeatmapDayRow,
  MetricConfig,
  MetricKey,
  MonthBlock,
} from './query-count-calendar'

import {
  buildMonthBlocks,
  buildMonthWindowModel,
  buildStatCards,
  CALENDAR_DAY_LABELS,
  earliestRowIso,
  formatCalendarDate,
  getIntensityClass,
  isoDate,
  METRIC_CONFIGS,
  METRIC_ORDER,
  pickVisibleMonthBlocks,
  summarizeVisibleBlocks,
} from './query-count-calendar'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createCustomChart } from '@/components/charts/factory'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// Day-of-week rows that get a left-gutter label (GitHub shows Mon/Wed/Fri).
const LABELLED_ROWS = new Set([1, 3, 5])

// Fixed dot size for every day cell. Kept small so the full year stays compact
// and the month blocks read as a calendar rather than a stretched strip.
const CELL = 'size-[11px]'
const CELL_GAP = 'gap-[2px]'

// Icon per metric for the toggle pills. Kept here (not in the pure calendar
// module) so that file stays React-free and unit-testable.
const METRIC_ICONS: Record<MetricKey, LucideIcon> = {
  queries: ActivityIcon,
  failed: CircleAlertIcon,
  memory: MemoryStickIcon,
  duration: TimerIcon,
  written: HardDriveIcon,
}

interface HoverState {
  day: CalendarDay
  x: number
  y: number
}

/** Drill into the day's queries. Failed mode jumps straight to /failed-queries. */
function buildDrilldownHref(
  hostId: number,
  day: CalendarDay,
  metricKey: MetricKey
): string {
  // Whole-day window. BETWEEN is inclusive on both ends in ClickHouse, so end
  // at 23:59:59 to keep the next day out of this cell's drilldown.
  const params = new URLSearchParams()
  params.set('host', String(hostId))
  params.set('event_time', `between:${day.iso} 00:00:00,${day.iso} 23:59:59`)
  const path = metricKey === 'failed' ? '/failed-queries' : '/history-queries'
  return `${path}?${params.toString()}`
}

/** Pill button that switches the active metric. */
function ModePill({
  metric,
  active,
  onSelect,
}: {
  metric: MetricConfig
  active: boolean
  onSelect: (key: MetricKey) => void
}) {
  const Icon = METRIC_ICONS[metric.key]
  return (
    <button
      type="button"
      onClick={() => onSelect(metric.key)}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground'
      )}
    >
      <Icon
        className={cn('size-3.5', !active && metric.accentText)}
        aria-hidden
      />
      {metric.label}
    </button>
  )
}

/** One KPI card in the summary strip. */
function StatCardView({
  label,
  value,
  sub,
  accentClass,
}: {
  label: string
  value: string
  sub?: string
  accentClass?: string
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <span className="text-muted-foreground truncate text-[10px] font-medium uppercase tracking-wide">
        {label}
      </span>
      <span
        className={cn(
          'mt-1 truncate text-lg font-semibold tabular-nums leading-tight',
          accentClass
        )}
      >
        {value}
      </span>
      {sub ? (
        <span className="text-muted-foreground mt-0.5 truncate text-[11px]">
          {sub}
        </span>
      ) : null}
    </div>
  )
}

function CalendarBody({
  data,
  hostId,
}: {
  data: HeatmapDayRow[]
  hostId: number
}) {
  const [mode, setMode] = useState<MetricKey>('queries')
  const [hover, setHover] = useState<HoverState | null>(null)
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Full per-day record (all metrics) keyed by ISO date, for the day dialog.
  const rowByIso = useMemo(() => {
    const m = new Map<string, HeatmapDayRow>()
    for (const r of data) m.set(r.date, r)
    return m
  }, [data])

  const metric = METRIC_CONFIGS[mode]
  // Available width of the calendar viewport, measured via ResizeObserver, used
  // to decide how many month blocks fit (oldest dropped first).
  const [gridWidth, setGridWidth] = useState(0)

  // `today` is read once per render from the local clock; memoize so the
  // cell build is off every hover re-render and only reruns on mode change.
  // The window spans whole months up to MAX_WINDOW_MONTHS back — including
  // empty months before the first data row — so a wide card fills its width.
  // pickVisibleMonthBlocks then drops those oldest months first on resize.
  // The current month always runs through its last day (remaining days dimmed).
  const dataStartIso = useMemo(() => earliestRowIso(data), [data])
  const model = useMemo(
    () => buildMonthWindowModel(data, new Date(), metric),
    [data, metric]
  )
  const monthBlocks = useMemo(() => buildMonthBlocks(model), [model])
  // Trim to the most recent months that fit the measured width; always keeps
  // the current month. Wide screens therefore reach further back in time.
  const visibleBlocks = useMemo(
    () => pickVisibleMonthBlocks(monthBlocks, gridWidth),
    [monthBlocks, gridWidth]
  )
  // KPIs, colour scale and range caption describe the visible data window,
  // not left-side padding months that only exist to fill the card.
  const summary = useMemo(
    () => summarizeVisibleBlocks(visibleBlocks, dataStartIso),
    [visibleBlocks, dataStartIso]
  )
  const statCards = useMemo(
    () => buildStatCards(metric, summary),
    [metric, summary]
  )
  const todayIso = isoDate(new Date())

  // Auto-focus the latest date: scroll the calendar to its right edge on mount
  // and whenever the data set changes. No-op when the grid already fits (wide
  // screens) since scrollWidth === clientWidth; matters on narrow/overflowing
  // viewports where the most recent weeks would otherwise be off-screen.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || data.length === 0) return
    const id = requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth
    })
    return () => cancelAnimationFrame(id)
  }, [data])

  // Track the viewport width so the grid shows as many recent months as fit
  // and drops the oldest on resize (keeping the current month visible).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setGridWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setGridWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (data.length === 0) {
    return (
      <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
        No recent query activity
      </div>
    )
  }

  const { max, rangeLabel } = summary
  const hasTraffic = max > 0

  // Render one day cell (or an empty spacer for masked/out-of-range slots).
  const renderDay = (day: CalendarDay | null, dow: number) => {
    if (!day) {
      return <div key={dow} className={CELL} aria-hidden />
    }
    // Future days of the current month: shown dimmed, not interactive.
    if (day.isFuture) {
      return (
        <div
          key={day.iso}
          className={cn(CELL, 'rounded-[2px] opacity-30', metric.tiers[0])}
          aria-hidden
        />
      )
    }
    const intensity = getIntensityClass(day.value, max, metric.tiers)
    const isToday = day.iso === todayIso
    const onEnter = (e: React.SyntheticEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const host = e.currentTarget.closest(
        '[data-calendar-root]'
      ) as HTMLElement | null
      const hostRect = host?.getBoundingClientRect()
      setHover({
        day,
        x: rect.left + rect.width / 2 - (hostRect?.left ?? 0),
        y: rect.top - (hostRect?.top ?? 0),
      })
    }
    return (
      <button
        key={day.iso}
        type="button"
        aria-label={`${day.readable} on ${formatCalendarDate(day.date)}`}
        onMouseEnter={onEnter}
        onFocus={onEnter}
        onMouseLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onClick={() => {
          setHover(null)
          setSelectedDay(day)
        }}
        className={cn(
          CELL,
          'rounded-[2px] transition-transform duration-100',
          'hover:scale-125 hover:ring-1 hover:ring-foreground/40',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          intensity,
          isToday && 'ring-1 ring-foreground/60'
        )}
      />
    )
  }

  return (
    <div
      data-calendar-root
      className="relative flex h-full w-full flex-col justify-center gap-3"
    >
      {/* Range caption + metric switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-muted-foreground font-mono text-xs">
          {rangeLabel}
        </span>
        {/* Metric switcher: a single inline row that scrolls horizontally when
            it can't fit (esp. mobile) instead of wrapping. A right-edge fade
            signals there's more to scroll to. */}
        <div className="relative min-w-0 max-w-full">
          <div className="scrollbar-hide flex gap-1.5 overflow-x-auto pr-5 sm:pr-0">
            {METRIC_ORDER.map((key) => (
              <ModePill
                key={key}
                metric={METRIC_CONFIGS[key]}
                active={key === mode}
                onSelect={setMode}
              />
            ))}
          </div>
          <div
            className="from-card pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l to-transparent sm:hidden"
            aria-hidden
          />
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <StatCardView
            key={card.label}
            label={card.label}
            value={card.value}
            sub={card.sub}
            accentClass={card.accent ? metric.accentText : undefined}
          />
        ))}
      </div>

      {/* Year calendar: a weekday gutter plus one self-contained block per
          month. Dots are a fixed small size (CELL) so the whole year stays
          compact, and each month is its own mini-grid so month boundaries read
          clearly. Scrolls horizontally on narrow screens and is auto-anchored
          to the latest month (older months clip off the left); the scrollbar is
          hidden for a cleaner look — swipe/wheel still scrolls back in time. */}
      <div ref={scrollRef} className="scrollbar-hide overflow-x-auto">
        <div className="flex w-full items-start gap-3">
          {/* Weekday gutter (Sun-first; GitHub shows Mon/Wed/Fri). The leading
              spacer aligns the rows with each block's month label. */}
          <div className={cn('flex flex-shrink-0 flex-col', CELL_GAP)}>
            <div className="mb-1 h-[10px]" aria-hidden />
            {CALENDAR_DAY_LABELS.map((label, dow) => (
              <div
                key={label}
                className="text-muted-foreground flex h-[11px] items-center justify-end pr-1 text-[9px] leading-none"
              >
                {LABELLED_ROWS.has(dow) ? label : ''}
              </div>
            ))}
          </div>

          {/* Months pack to the right so leftover space is on the left.
              Extra empty months are added there to fill; on resize the
              oldest (left) months drop first. */}
          <div className="flex min-w-0 flex-1 items-start justify-end gap-3">
            {visibleBlocks.map((block: MonthBlock) => (
              <div key={block.key} className="flex flex-col">
                <div className="text-muted-foreground mb-1 h-[10px] text-[10px] leading-none">
                  {block.label}
                </div>
                <div className={cn('flex', CELL_GAP)}>
                  {block.weeks.map((week, wi) => (
                    <div
                      key={week.find(Boolean)?.iso ?? `${block.key}-w${wi}`}
                      className={cn('flex flex-col', CELL_GAP)}
                    >
                      {week.map((day, dow) => renderDay(day, dow))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer: helper text + Less→More legend */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Click any day for details · hover for daily totals
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-[11px]">Less</span>
          <div className="flex items-center gap-[3px]">
            {metric.tiers.map((tierClass) => (
              <div
                key={tierClass}
                className={cn(
                  'size-[11px] flex-shrink-0 rounded-[3px]',
                  tierClass
                )}
              />
            ))}
          </div>
          <span className="text-muted-foreground text-[11px]">More</span>
        </div>
      </div>

      {/* Shared floating tooltip — one node for the whole grid (vs. a Radix
          Tooltip per cell, which would mount hundreds of roots). Positioned
          relative to the [data-calendar-root] container above. */}
      <div className="pointer-events-none absolute inset-0">
        {hover ? (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
            style={{ left: hover.x, top: hover.y - 6 }}
          >
            <div className="bg-popover text-popover-foreground border-border/60 flex min-w-[170px] flex-col gap-1 rounded-md border px-3 py-2 shadow-md">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold tabular-nums">
                  {hover.day.readable}
                </span>
                <span className="text-muted-foreground text-[10px] tabular-nums">
                  {hasTraffic ? Math.round((hover.day.value * 100) / max) : 0}%
                  of peak
                </span>
              </div>
              <span className="text-muted-foreground text-[11px]">
                {formatCalendarDate(hover.day.date)}
              </span>
              <div className="border-border/60 flex items-center gap-1 border-t pt-1 text-[10px]">
                <span className={metric.accentText}>
                  {mode === 'failed' ? 'View failed queries' : 'View queries'}
                </span>
                <ArrowUpRightIcon className="size-3" />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Day detail dialog — opens on click with every metric for that day,
          plus a link to drill into the day's queries. */}
      <Dialog
        open={selectedDay !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedDay(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          {selectedDay ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {formatCalendarDate(selectedDay.date)}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  {METRIC_ORDER.map((key) => {
                    const cfg = METRIC_CONFIGS[key]
                    const row = rowByIso.get(selectedDay.iso)
                    const value = row ? cfg.getValue(row) : 0
                    return (
                      <div
                        key={key}
                        className="border-border/60 bg-card/40 rounded-lg border px-3 py-2"
                      >
                        <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                          {cfg.label}
                        </span>
                        <div
                          className={cn(
                            'mt-0.5 text-base font-semibold tabular-nums',
                            cfg.accentText
                          )}
                        >
                          {cfg.format(value)}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <Link
                  to={buildDrilldownHref(hostId, selectedDay, mode)}
                  onClick={() => setSelectedDay(null)}
                  className="border-border bg-card hover:bg-accent inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors"
                >
                  {mode === 'failed'
                    ? 'View failed queries'
                    : 'View queries for this day'}
                  <ArrowUpRightIcon className="size-3.5" />
                </Link>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export const ChartQueryCountHeatmap = createCustomChart({
  chartName: 'query-count-heatmap',
  defaultTitle: 'Query Activity Heatmap',
  // Two years of daily aggregates so wide screens have history to fill with;
  // the client always builds up to MAX_WINDOW_MONTHS (empty months on the
  // left when query_log is short) and trims oldest-first to the card width.
  defaultLastHours: 24 * 365 * 2,
  dataTestId: 'query-count-heatmap-chart',
  contentClassName: 'overflow-hidden',
  render: (dataArray, _sql, hostId) => (
    <CalendarBody data={dataArray as HeatmapDayRow[]} hostId={hostId} />
  ),
})

export default ChartQueryCountHeatmap
