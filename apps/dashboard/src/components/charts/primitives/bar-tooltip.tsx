import {
  ChartTooltip,
  ChartTooltipContent,
  type ChartTooltipContentProps,
} from '@/components/ui/chart'
import { formatCompactNumber } from '@/lib/format-number'

interface RenderBarTooltipOptions {
  tooltipTotal: boolean
  categories: string[]
}

/**
 * Custom tooltip content wrapper that sorts items by value descending.
 * This is needed because Recharts itemSorter only works with DefaultTooltipContent,
 * not custom content components like ChartTooltipContent.
 */
function SortedTooltipContent(props: ChartTooltipContentProps) {
  const { payload, ...rest } = props

  const sortedPayload = payload
    ? [...payload].sort((a, b) => {
        const aVal = typeof a.value === 'number' ? a.value : 0
        const bVal = typeof b.value === 'number' ? b.value : 0
        return bVal - aVal // Descending
      })
    : payload

  return <ChartTooltipContent {...rest} payload={sortedPayload} />
}

/**
 * Render function for BarChart tooltip
 *
 * IMPORTANT: This must be a render function (not a component) because Recharts
 * identifies tooltip components by checking direct children's displayName.
 * Wrapping <ChartTooltip> in a component prevents Recharts from finding it.
 */
export function renderBarTooltip({
  tooltipTotal,
  categories,
}: RenderBarTooltipOptions) {
  if (tooltipTotal) {
    // Tooltip with total for stacked bars
    // Disable cursor fill for bar charts - the bar colors should remain visible on hover
    return (
      <ChartTooltip
        cursor={false}
        wrapperStyle={{ zIndex: 1000 }}
        content={
          <SortedTooltipContent
            formatter={(value, name, item, index) => (
              <>
                <div
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-muted-foreground">
                  {name === '' || name == null ? '(empty)' : name}
                </span>
                <span className="ml-auto font-mono text-xs font-medium tabular-nums text-foreground">
                  {typeof value === 'number'
                    ? formatCompactNumber(value)
                    : value}
                </span>
                {index === categories.length - 1 && (
                  <div className="mt-1.5 flex basis-full items-center border-t pt-1.5 text-xs font-medium text-foreground">
                    Total
                    <span className="ml-auto font-mono text-xs font-medium tabular-nums">
                      {formatCompactNumber(
                        categories
                          .map((cat) => Number(item.payload[cat]) || 0)
                          .reduce((a, b) => a + b, 0)
                      )}
                    </span>
                  </div>
                )}
              </>
            )}
          />
        }
      />
    )
  }

  // Standard tooltip without total
  // Disable cursor fill for bar charts - the bar colors should remain visible on hover
  return (
    <ChartTooltip
      cursor={false}
      wrapperStyle={{ zIndex: 1000 }}
      content={
        <SortedTooltipContent
          formatter={(value, name, item) => (
            <>
              <div
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-muted-foreground">
                {!name || (typeof name === 'string' && name.trim() === '')
                  ? '(empty)'
                  : name}
              </span>
              <span className="ml-auto font-mono text-xs font-medium tabular-nums text-foreground">
                {typeof value === 'number' ? formatCompactNumber(value) : value}
              </span>
            </>
          )}
        />
      }
    />
  )
}
