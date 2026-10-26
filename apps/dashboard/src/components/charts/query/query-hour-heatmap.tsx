import { getIntensityClass, METRIC_CONFIGS } from './query-count-calendar'
import { createCustomChart } from '@/components/charts/factory'
import { cn } from '@/lib/utils'

/** One row of `query-hour-heatmap`: weekday is 1 (Monday) to 7 (Sunday). */
export interface HourHeatmapRow {
  weekday: number
  hour: number
  queries: number
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** 7 x 24 grid of query counts, keyed `weekday-hour`; missing cells are 0. */
export function buildHourGrid(rows: HourHeatmapRow[]) {
  const counts = new Map<string, number>()
  let max = 0
  for (const r of rows) {
    const n = Number(r.queries) || 0
    counts.set(`${Number(r.weekday)}-${Number(r.hour)}`, n)
    if (n > max) max = n
  }
  const grid = WEEKDAYS.map((_, i) =>
    HOURS.map((h) => counts.get(`${i + 1}-${h}`) ?? 0)
  )
  return { grid, max }
}

function HourHeatmapBody({ data }: { data: HourHeatmapRow[] }) {
  const { grid, max } = buildHourGrid(data)
  const tiers = METRIC_CONFIGS.queries.tiers

  if (max === 0) {
    return (
      <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
        No queries in this window
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid w-full grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-[2px] text-[10px] max-sm:text-xs">
        <span aria-hidden />
        {HOURS.map((h) => (
          <span
            key={h}
            className="text-muted-foreground text-center tabular-nums"
          >
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
        {grid.map((row, i) => [
          <span
            key={WEEKDAYS[i]}
            className="text-muted-foreground pr-1 text-right leading-4 sm:leading-5"
          >
            {WEEKDAYS[i]}
          </span>,
          ...row.map((n, h) => (
            <span
              key={`${WEEKDAYS[i]}-${HOURS[h]}`}
              title={`${WEEKDAYS[i]} ${String(h).padStart(2, '0')}:00 · ${n.toLocaleString()} queries`}
              className={cn(
                'h-4 rounded-[3px] sm:h-5',
                getIntensityClass(n, max, tiers)
              )}
            />
          )),
        ])}
      </div>
      <p className="text-muted-foreground text-xs">
        Server time zone · hover a cell for its count
      </p>
    </div>
  )
}

export const ChartQueryHourHeatmap = createCustomChart({
  chartName: 'query-hour-heatmap',
  defaultTitle: 'Weekday x Hour',
  defaultLastHours: 24 * 7,
  dataTestId: 'query-hour-heatmap-chart',
  render: (dataArray) => (
    <HourHeatmapBody data={dataArray as HourHeatmapRow[]} />
  ),
})
