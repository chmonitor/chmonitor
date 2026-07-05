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
import { augmentWithBand, OVERLAY_KEYS } from '@/lib/insights/anomaly-overlay'
import { useStatsInsightsSettings } from '@/lib/query/use-stats-insights-settings'
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

/**
 * Custom recharts `dot` renderer for the anomaly-overlay series: draws a small
 * red dot only on points flagged `__anomaly` (outside the ±k·σ band), and
 * nothing otherwise. Kept as a plain Area `dot` so it works without recharts'
 * `ReferenceDot` (not resolvable in this build).
 */
function AnomalyDot(props: {
  cx?: number
  cy?: number
  payload?: Record<string, unknown>
}) {
  const { cx, cy, payload } = props
  if (!payload?.[OVERLAY_KEYS.anomaly] || cx == null || cy == null) {
    return <g />
  }
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3}
      fill="var(--chart-red, var(--destructive))"
      stroke="var(--background)"
      strokeWidth={1}
    />
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
  anomalyOverlay,
}: AreaChartProps & {
  yAxisTickFormatter?: (value: string | number) => string
  height?: string
}) {
  // Get scale preference from context (if available)
  const contextScale = useChartScaleValue()

  // Statistics-Insights overlay settings (moving-average band + threshold).
  // Read unconditionally (hooks rule) but only applied when a chart opts in via
  // `anomalyOverlay`; every other area chart is unaffected.
  const { settings: statsSettings } = useStatsInsightsSettings()
  const overlay =
    anomalyOverlay && index && categories.includes(anomalyOverlay.category)
      ? anomalyOverlay
      : undefined
  const bandEnabled = Boolean(overlay) && statsSettings.showMovingAverage
  const thresholdEnabled =
    Boolean(overlay) &&
    statsSettings.showThreshold &&
    statsSettings.threshold != null

  const augmented = bandEnabled
    ? augmentWithBand(
        data as Record<string, unknown>[],
        index as string,
        (overlay as { category: string }).category,
        statsSettings.maWindow,
        statsSettings.bandMultiplier
      )
    : null
  const chartData = augmented ? augmented.rows : data

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
        data={chartData}
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
            // Flag out-of-band points on the analyzed series only.
            dot={
              bandEnabled && overlay?.category === category ? (
                <AnomalyDot />
              ) : (
                false
              )
            }
          />
        ))}

        {/* Statistics-Insights anomaly overlay (opt-in, driven by settings). */}
        {bandEnabled && (
          <Area
            key="__ma-band"
            dataKey={OVERLAY_KEYS.band}
            stroke="none"
            fill="var(--muted-foreground)"
            fillOpacity={0.12}
            isAnimationActive={false}
            legendType="none"
            tooltipType="none"
            activeDot={false}
            connectNulls
          />
        )}
        {bandEnabled && (
          // Drawn as an Area with no fill — recharts' AreaChart only renders
          // Area children as graphical items (a <Line> child is ignored), so a
          // stroke-only Area is how we get the moving-average line.
          <Area
            key="__ma-line"
            dataKey={OVERLAY_KEYS.ma}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            legendType="none"
            tooltipType="none"
            connectNulls
          />
        )}
        {thresholdEnabled && (
          <ReferenceLine
            y={statsSettings.threshold as number}
            stroke="var(--chart-red, var(--destructive))"
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{
              value: `threshold ${statsSettings.threshold}`,
              position: 'insideTopRight',
              fill: 'var(--muted-foreground)',
              fontSize: 10,
            }}
          />
        )}

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
