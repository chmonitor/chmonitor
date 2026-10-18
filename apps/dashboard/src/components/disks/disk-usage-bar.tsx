import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export function usageLevel(percentUsed: number): 'ok' | 'warn' | 'critical' {
  if (percentUsed >= 90) return 'critical'
  if (percentUsed >= 75) return 'warn'
  return 'ok'
}

const INDICATOR_CLASS: Record<ReturnType<typeof usageLevel>, string> = {
  ok: '[&>div]:bg-emerald-500',
  warn: '[&>div]:bg-amber-500',
  critical: '[&>div]:bg-red-500',
}

const TRACK_CLASS: Record<ReturnType<typeof usageLevel>, string> = {
  ok: 'bg-emerald-500/15',
  warn: 'bg-amber-500/15',
  critical: 'bg-red-500/15',
}

interface DiskUsageBarProps {
  percentUsed: number
  className?: string
}

export function DiskUsageBar({ percentUsed, className }: DiskUsageBarProps) {
  const level = usageLevel(percentUsed)
  const clamped = Math.max(0, Math.min(100, percentUsed))

  return (
    <Progress
      value={clamped}
      aria-label={`Disk used ${clamped.toFixed(1)}%`}
      className={cn(
        'h-2.5',
        TRACK_CLASS[level],
        INDICATOR_CLASS[level],
        className
      )}
    />
  )
}
