import { cn } from '@/lib/utils'

export interface CardMultiMetricsProps {
  primary?: string | number | React.ReactNode
  items?: {
    current: number
    target: number
    currentReadable?: string
    targetReadable?: string
    label?: string
  }[]
  currentLabel?: string
  targetLabel?: string
  className?: string
}

const DottedLineProgress = function DottedLineProgress({
  percent,
  className,
}: {
  percent: number
  className?: string
}) {
  const clampedPercent = Math.min(100, Math.max(0, percent))

  return (
    <div
      className={cn('relative flex-1 h-3 min-w-8', className)}
      data-testid="metric-progress"
    >
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-dotted border-muted-foreground/20" />
      </div>
      <div
        className="absolute inset-0 flex items-center overflow-hidden"
        style={{ width: `${clampedPercent}%` }}
      >
        <div className="w-full border-t border-dotted border-primary" />
      </div>
    </div>
  )
}

export const CardMultiMetrics = function CardMultiMetrics({
  primary,
  items = [],
  currentLabel,
  targetLabel,
  className,
}: CardMultiMetricsProps) {
  const showLabels = items.length > 0 && (currentLabel || targetLabel)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {primary && (
        <div className="text-xl font-semibold leading-tight">{primary}</div>
      )}

      <div className="flex flex-col gap-2.5 overflow-hidden">
        {showLabels && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span className="truncate flex-1 min-w-0">{currentLabel}</span>
            <span className="shrink-0 min-w-8 flex-1" />
            <span className="truncate flex-1 min-w-0 text-right">
              {targetLabel}
            </span>
          </div>
        )}

        {items.map((item, i) => {
          const percent =
            item.target > 0 ? (item.current / item.target) * 100 : 0
          const clampedPercent = Math.min(100, Math.max(0, percent))
          // Index suffix keeps the fallback unique when readables repeat.
          const key =
            item.label ?? `${item.currentReadable}-${item.targetReadable}-${i}`

          return (
            <div key={key} className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground truncate flex-1 min-w-0 tabular-nums">
                {item.currentReadable}
              </span>
              <DottedLineProgress
                percent={clampedPercent}
                className="shrink-0"
              />
              <span className="font-medium truncate flex-1 min-w-0 text-right tabular-nums">
                {item.targetReadable}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
