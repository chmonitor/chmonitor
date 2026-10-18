import { cn } from '@/lib/utils'

export interface BarListProps {
  data: Array<{
    name: string
    value: number
    [key: string]: any
  }>
  formatedColumn?: string
  className?: string
}

export const BarList = function BarList({
  data,
  formatedColumn,
  className,
}: BarListProps) {
  const compactFormat = (value: number): string => {
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
    return value.toLocaleString()
  }

  const valueFormatter = (() => {
    if (!formatedColumn) {
      return (value: number) => compactFormat(value)
    }

    return (value: number) => {
      const formatted = data.find((d) => d.value === value)?.[
        formatedColumn
      ] as string
      // Use compact format if string is too long or contains verbose words
      if (
        formatted &&
        (formatted.length > 10 || /million|billion|thousand/i.test(formatted))
      ) {
        return compactFormat(value)
      }
      return formatted || compactFormat(value)
    }
  })()

  const sortedData = (() => {
    return [...data].sort((a, b) => b.value - a.value)
  })()

  const maxValue = (() => {
    return Math.max(...sortedData.map((d) => d.value), 1)
  })()

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {sortedData.map((item, index) => {
        const percentage = (item.value / maxValue) * 100
        const opacity = Math.round(
          100 - (index / Math.max(sortedData.length - 1, 1)) * 40
        )
        const bgColor = `color-mix(in oklch, var(--chart-1) ${opacity}%, transparent)`

        return (
          <div
            key={item.name}
            className="relative h-7 overflow-hidden rounded"
            data-testid="bar-list-item"
          >
            <div
              className="absolute inset-y-0 left-0 rounded"
              data-testid="bar-list-fill"
              style={{
                width: `${percentage}%`,
                backgroundColor: bgColor,
              }}
            />
            {/* Single foreground-text layer. The fill is a semi-transparent
                tint over the card, so theme `text-foreground` stays readable on
                both the filled and empty regions AND keeps a WCAG-AA contrast
                ratio against the card background (which is what axe computes —
                the fill is a sibling, not the text's background). */}
            <div className="absolute inset-0 flex items-center justify-between">
              <span
                className="truncate px-2.5 text-sm font-medium text-foreground"
                data-testid="bar-list-label-contrast"
              >
                {item.name}
              </span>
              <span className="shrink-0 px-2.5 font-mono text-sm font-medium tabular-nums text-foreground">
                {valueFormatter(item.value)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
