import { createCustomChart } from '@/components/charts/factory'
import { formatCount } from '@/lib/utils'

interface ErrorsByCodeData {
  exception_code: number
  count: number
  sample: string
  last_seen: string
}

/** Errors drill-down: failures grouped by exception code, with a sample message per code. */
export const ChartQueryInsightsErrorsByCode = createCustomChart({
  chartName: 'query-insights-errors-by-code',
  defaultTitle: 'Errors by Exception Code',
  defaultLastHours: 24,
  dataTestId: 'query-insights-errors-by-code-chart',
  dateRangeConfig: 'query-activity',
  render: (dataArray) => {
    const data = dataArray as ErrorsByCodeData[]

    if (data.length === 0) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
          No errors recorded
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-3 overflow-y-auto">
        {data.map((row) => (
          <div key={row.exception_code} className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="truncate font-medium">
                Code {row.exception_code}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {formatCount(row.count)}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {row.sample || '—'}
            </p>
          </div>
        ))}
      </div>
    )
  },
})

export default ChartQueryInsightsErrorsByCode
