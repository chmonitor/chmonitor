import { bucketSeries, downsample } from './peerdb-utils'
import { useId } from 'react'

/**
 * SVG charts ported verbatim from the CHM Redesign prototype (shared.jsx).
 * Hand-rolled (not recharts) so the smooth catmull-rom curve, gradient fill,
 * and dashed gridlines match the design pixel-for-pixel.
 */

function smoothPath(
  values: number[],
  width: number,
  height: number,
  pad = 2
): { line: string; norm: (v: number) => number; step: number } {
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const norm = (v: number) =>
    height - ((v - min) / (max - min || 1)) * (height - pad * 2) - pad
  const step = width / (values.length - 1 || 1)
  let line = `M 0 ${norm(values[0])}`
  for (let i = 1; i < values.length; i++) {
    const x0 = (i - 1) * step
    const x1 = i * step
    const cx = (x0 + x1) / 2
    line += ` C ${cx} ${norm(values[i - 1])} ${cx} ${norm(values[i])} ${x1} ${norm(values[i])}`
  }
  return { line, norm, step }
}

interface PdbSparklineProps {
  data: number[]
  color?: string
  height?: number
  width?: number
  fill?: number
}

export function PdbSparkline({
  data,
  color = '#10b981',
  height = 32,
  width = 120,
  fill = 0.28,
}: PdbSparklineProps) {
  const gid = useId()
  // Cap rendered points to roughly the pixel width — more is invisible but
  // still costs DOM/curve work when a mirror returns thousands of samples.
  const points = downsample(data ?? [], width)
  const { line } = smoothPath(points, width, height)
  if (!data || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-muted-foreground/60"
        style={{ width, height }}
      >
        —
      </div>
    )
  }
  return (
    <svg width={width} height={height} className="block">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={fill} />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${line} L ${width} ${height} L 0 ${height} Z`}
        fill={`url(#${gid})`}
      />
      <path d={line} fill="none" stroke={color} strokeWidth="1.4" />
    </svg>
  )
}

interface PdbBarChartProps {
  data: { x: string; y: number }[]
  color?: string
  height?: number
  valueFormatter?: (v: number) => string
}

/**
 * Axis'd bar chart ("rows synced at a point in time") for QRep partition sync
 * history. CSS bars (not SVG) so the left value axis and bottom time labels
 * align crisply at any width.
 */
export function PdbBarChart({
  data,
  color = '#3b82f6',
  height = 200,
  valueFormatter,
}: PdbBarChartProps) {
  // Keep at most ~120 bars so a long history stays legible and cheap. Bars are
  // ~2px min; more would just overlap.
  const bars = bucketSeries(data ?? [], 120)
  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[11px] text-muted-foreground"
        style={{ height }}
      >
        No sync history
      </div>
    )
  }
  const max = Math.max(...bars.map((d) => d.y), 1)
  const fmt = valueFormatter ?? ((v: number) => `${Math.round(v)}`)
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => f * max)
  const labelEvery = Math.max(1, Math.ceil(bars.length / 8))

  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-12 shrink-0 flex-col justify-between pr-2 text-right text-[10px] tabular-nums text-muted-foreground">
          {ticks.map((t, i) => (
            <span key={i}>{fmt(t)}</span>
          ))}
        </div>
        <div className="relative flex-1 border-b border-l border-border">
          {[0.25, 0.5, 0.75].map((f) => (
            <div
              key={f}
              className="absolute inset-x-0 border-t border-dashed border-border/60"
              style={{ bottom: `${f * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-px px-1">
            {bars.map((d, i) => (
              <div
                key={`${d.x}-${i}`}
                className="min-w-[2px] flex-1 rounded-t-sm transition-all hover:opacity-80"
                style={{
                  height: `${Math.max(d.y > 0 ? 1 : 0, (d.y / max) * 100)}%`,
                  background: color,
                }}
                title={`${d.x}: ${fmt(d.y)}`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="flex pl-12 pt-1 text-[9.5px] tabular-nums text-muted-foreground">
        <div className="flex flex-1 justify-between px-1">
          {bars
            .filter((_, i) => i % labelEvery === 0)
            .map((d, i) => (
              <span key={`${d.x}-${i}`} className="whitespace-nowrap">
                {d.x}
              </span>
            ))}
        </div>
      </div>
    </div>
  )
}

interface PdbAreaChartProps {
  data: number[]
  color?: string
  height?: number
  fill?: number
}

export function PdbAreaChart({
  data,
  color = '#10b981',
  height = 100,
  fill = 0.22,
}: PdbAreaChartProps) {
  const gid = useId()
  // The chart is drawn in a 100-unit viewBox; ~160 points is far more than the
  // curve can resolve, so downsample longer series before building the path.
  const points = downsample(data ?? [], 160)
  const { line } = smoothPath(points, 100, 100, 4)
  if (!data || data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[11px] text-muted-foreground"
        style={{ height }}
      >
        No data
      </div>
    )
  }
  const w = 100
  const h = 100
  return (
    <div className="w-full" style={{ height }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="block h-full w-full"
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={fill} />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((p) => (
          <line
            key={p}
            x1="0"
            x2={w}
            y1={h * p + 2}
            y2={h * p + 2}
            stroke="currentColor"
            className="text-border"
            strokeWidth="0.2"
            strokeDasharray="0.6 0.6"
          />
        ))}
        <path d={`${line} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${gid})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}
