import { sparklinePoints } from './fleet-helpers'
import { cn } from '@/lib/utils'

const WIDTH = 100
const HEIGHT = 20

interface FleetSparklineProps {
  values: readonly number[] | undefined
  label: string
  className?: string
}

/**
 * Minimal inline-SVG sparkline for a Fleet host card. Deliberately not a
 * Recharts chart: it renders once per host card with no axes, tooltip or
 * responsive container, so it stays cheap in a grid of many hosts.
 *
 * Fail-soft by design — `system.metric_log` is opt-in in ClickHouse, so the
 * caller passes `undefined` when the series is unavailable and nothing renders.
 */
export function FleetSparkline({
  values,
  label,
  className,
}: FleetSparklineProps) {
  const points = sparklinePoints(values ?? [], WIDTH, HEIGHT)
  if (!points) return null

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={cn('h-5 w-full text-chart-1', className)}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
