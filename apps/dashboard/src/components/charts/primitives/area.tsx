import {
  Area,
  CartesianGrid,
  AreaChart as RechartAreaChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'

import type { AreaChartDeploymentMarker, AreaChartProps } from '@/types/charts'

import {
  PinnedBreakdownTooltip,
  renderChartTooltip,
} from './area-chart-tooltip'
import { useChartScaleValue } from '@/components/charts/chart-scale-context'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart'
import { getYAxisDomain, resolveYAxisScale } from '@/lib/chart-scale'
import { cn } from '@/lib/utils'

/**
 * Finds the `index` bucket in `data` whose parsed value is closest to
 * `timestampMs` — deployments rarely land exactly on a bucket boundary, so
 * the marker snaps to the nearest one. Returns undefined when `data` has no
 * parseable `index` values (e.g. empty chart).
 */
export function findNearestBucketKey(
  data: Record<string, unknown>[],
  index: string,
  timestampMs: number
): string | number | undefined {
  let nearestKey: string | number | undefined
  let nearestDiff = Number.POSITIVE_INFINITY

  for (const row of data) {
    const raw = row[index]
    if (typeof raw !== 'string' && typeof raw !== 'number') continue
    const bucketMs = new Date(raw).getTime()
    if (!Number.isFinite(bucketMs)) continue
    const diff = Math.abs(bucketMs - timestampMs)
    if (diff < nearestDiff) {
      nearestDiff = diff
      nearestKey = raw
    }
  }

  return nearestKey
}

/**
 * Custom `<ReferenceLine label>` renderer — recharts clones this element
 * with `viewBox` (the line's pixel position) at render time. Renders a small
 * clickable dot with a native SVG `<title>` for hover detail (repo · env ·
 * version), since recharts' `ReferenceLine` has no built-in hover tooltip.
 */
function DeploymentMarkerLabel({
  viewBox,
  deployment,
  onSelect,
}: {
  viewBox?: { x?: number; y?: number }
  deployment: AreaChartDeploymentMarker
  onSelect?: (deployment: AreaChartDeploymentMarker) => void
}) {
  const x = viewBox?.x ?? 0
  const y = viewBox?.y ?? 0
  const tooltipText = [
    deployment.repo,
    deployment.environment,
    deployment.version ?? (deployment.sha ? deployment.sha.slice(0, 7) : null),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onClick={() => onSelect?.(deployment)}
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
      <title>{tooltipText}</title>
      <circle
        r={4}
        fill="var(--chart-yellow, currentColor)"
        stroke="var(--background)"
        strokeWidth={1.5}
      />
    </g>
  )
}

export const AreaChart = function AreaChart({
  data,
  index,
  categories,
  showLegend = false,
  showXAxis = true,
  showYAxis = true,
  showCartesianGrid = true,
  stack = false,
  opacity = 0.6,
  colors,
  colorLabel,
  tickFormatter,
  yAxisTickFormatter,
  xAxisLabel,
  yAxisLabel,
  breakdown,
  breakdownLabel,
  breakdownValue,
  breakdownHeading,
  tooltipActive,
  chartConfig: customChartConfig,
  className,
  yAxisScale,
  height = 'h-full',
  deployments,
  onDeploymentSelect,
}: AreaChartProps & {
  yAxisTickFormatter?: (value: string | number) => string
  height?: string
}) {
  // Get scale preference from context (if available)
  const contextScale = useChartScaleValue()

  // Use prop if provided, otherwise use context, otherwise 'linear'
  const effectiveScale = yAxisScale ?? contextScale ?? 'linear'

  // Resolve scale type (linear, log, or auto-detect)
  const resolvedScale = resolveYAxisScale(
    effectiveScale,
    data as Record<string, unknown>[],
    categories
  )

  // Get appropriate domain for the scale type
  const yAxisDomain = getYAxisDomain(
    data as Record<string, unknown>[],
    categories,
    resolvedScale === 'log'
  )
  const chartConfig = (() => {
    const config = categories.reduce(
      (acc, category, index) => {
        acc[category] = {
          label: category,
          color: colors ? `var(${colors[index]})` : `var(--chart-${index + 1})`,
        }

        return acc
      },
      {
        label: {
          color: colorLabel ? `var(${colorLabel})` : 'var(--background)',
        },
      } as ChartConfig
    )

    return {
      ...config,
      ...(customChartConfig || {}),
    }
  })()

  // Deploy markers (opt-in overlay, plans/45-github-deploy-correlation.md):
  // snap each deployment to its nearest bucket on the `index` axis so
  // ReferenceLine's category-axis `x` matches an actual data point.
  const deploymentMarkers = index
    ? (deployments ?? []).flatMap((deployment) => {
        const bucketKey = findNearestBucketKey(
          data as Record<string, unknown>[],
          index,
          deployment.createdAt
        )
        return bucketKey === undefined ? [] : [{ bucketKey, deployment }]
      })
    : []

  // Memoize tooltip renderer to prevent recreation on every render
  const tooltip = renderChartTooltip({
    breakdown,
    breakdownLabel,
    breakdownValue,
    breakdownHeading,
    tooltipActive,
    chartConfig,
    categories,
  })

  const chart = (
    <ChartContainer
      config={chartConfig}
      className={cn('!aspect-auto w-full min-w-0', height, className)}
    >
      <RechartAreaChart
        accessibilityLayer
        data={data}
        margin={{
          top: 4,
          left: 12,
          right: 12,
        }}
      >
        {showCartesianGrid && <CartesianGrid vertical={false} />}
        {showXAxis && (
          <XAxis
            dataKey={index}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={tickFormatter}
            interval={'equidistantPreserveStart'}
            label={
              xAxisLabel
                ? { value: xAxisLabel, position: 'insideBottom', offset: -10 }
                : undefined
            }
          />
        )}
        {showYAxis && (
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={yAxisTickFormatter}
            scale={resolvedScale}
            domain={yAxisDomain}
            allowDataOverflow={resolvedScale === 'log'}
            label={
              yAxisLabel
                ? { value: yAxisLabel, angle: -90, position: 'insideLeft' }
                : undefined
            }
          />
        )}

        {tooltip}

        {categories.map((category) => (
          <Area
            key={`${category}`}
            dataKey={category}
            fill={`var(--color-${category})`}
            stroke={`var(--color-${category})`}
            strokeWidth={2}
            stackId={stack ? 'a' : undefined}
            type="linear"
            fillOpacity={opacity}
          />
        ))}

        {showLegend && <ChartLegend content={<ChartLegendContent />} />}

        {deploymentMarkers.map(({ bucketKey, deployment }) => (
          <ReferenceLine
            key={deployment.id}
            x={bucketKey}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={
              <DeploymentMarkerLabel
                deployment={deployment}
                onSelect={onDeploymentSelect}
              />
            }
          />
        ))}
      </RechartAreaChart>
    </ChartContainer>
  )

  const latestData = data.at(-1)

  if (breakdown && tooltipActive && categories[0] && latestData) {
    return (
      <div className={cn('relative w-full min-w-0', height, className)}>
        {chart}
        <PinnedBreakdownTooltip
          data={latestData as Record<string, unknown>}
          category={categories[0]}
          breakdown={breakdown}
          breakdownLabel={breakdownLabel}
          breakdownValue={breakdownValue}
          breakdownHeading={breakdownHeading}
          chartConfig={chartConfig}
        />
      </div>
    )
  }

  return chart
}
