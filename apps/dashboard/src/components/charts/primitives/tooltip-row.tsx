import type { ChartConfig } from '@/components/ui/chart'

import { TooltipColorIndicator } from './tooltip-color-indicator'
import { formatCompactNumber } from '@/lib/format-number'

interface StandardTooltipRowProps {
  name: string
  value: any
  item: any
  chartConfig: ChartConfig
}

export function StandardTooltipRow({
  name,
  value,
  item,
  chartConfig,
}: StandardTooltipRowProps) {
  return (
    <div className="flex flex-row items-center justify-between gap-2 min-w-0">
      <TooltipRowLabel name={name} chartConfig={chartConfig} />
      <TooltipRowValue item={item} name={name} value={value} />
    </div>
  )
}

interface SummaryRowProps {
  name: string
  value: any
  chartConfig: ChartConfig
}

export function SummaryRow({ name, value, chartConfig }: SummaryRowProps) {
  return (
    <div className="flex flex-row items-center justify-between gap-2 min-w-0">
      <TooltipRowLabel name={name} chartConfig={chartConfig} />
      <div className="text-foreground shrink-0 flex items-baseline gap-0.5 font-mono font-medium tabular-nums">
        {value}
        <span className="text-muted-foreground font-normal"></span>
      </div>
    </div>
  )
}

interface TooltipRowLabelProps {
  name: string
  chartConfig: ChartConfig
}

function TooltipRowLabel({ name, chartConfig }: TooltipRowLabelProps) {
  return (
    <div className="flex flex-row items-center gap-1.5 min-w-0">
      <TooltipColorIndicator colorVar={`var(--color-${name})`} />
      <span className="truncate text-muted-foreground">
        {chartConfig[name as keyof typeof chartConfig]?.label || name}
      </span>
    </div>
  )
}

interface TooltipRowValueProps {
  item: any
  name: string
  value: any
}

function TooltipRowValue({ item, name, value }: TooltipRowValueProps) {
  return (
    <div className="text-foreground shrink-0 flex items-baseline gap-0.5 font-mono text-xs font-medium tabular-nums">
      {item.payload[`readable_${name}` as keyof typeof item] ||
        (typeof value === 'number' ? formatCompactNumber(value) : value)}
      <span className="text-muted-foreground font-normal"></span>
    </div>
  )
}
