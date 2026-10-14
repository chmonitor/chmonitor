import type { Sparkles } from 'lucide-react'

import { formatReadableQuantity, num, SIZE_BINS, TONE_COLOR } from './lib'
import { cn } from '@/lib/utils'

// ───────────────────────── shared card primitives ─────────────────────────

export const cardClass =
  'flex flex-col rounded-xl border border-border bg-card p-3.5'
export const labelClass =
  'text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground'

export function ChartCard({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return <div className={cn(cardClass, className)}>{children}</div>
}

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}

function DeltaChip({ text }: { text: string }) {
  const positive = text.startsWith('+')
  const negative = text.startsWith('-')
  return (
    <span
      className={cn(
        'rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums',
        positive &&
          'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
        negative &&
          'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
        !positive && !negative && 'border-border bg-muted text-muted-foreground'
      )}
    >
      {text}
    </span>
  )
}

export function Kpi({
  label,
  value,
  unit,
  sub,
  delta,
  icon: Icon,
  accent,
}: {
  label: string
  value: string
  unit?: string
  sub: string
  delta?: string
  icon: typeof Sparkles
  accent?: string
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn(labelClass, 'truncate')}>{label}</span>
        <Icon className="size-3.5 shrink-0 text-muted-foreground/60" />
      </div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className="text-[22px] font-bold leading-none tracking-tight tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </span>
        {unit && (
          <span className="text-[12px] text-muted-foreground">{unit}</span>
        )}
        {delta && (
          <span className="ml-auto">
            <DeltaChip text={delta} />
          </span>
        )}
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  )
}

// ───────────────────────── lifecycle stacked bars (24h) ─────────────────────────

export interface LifecyclePoint {
  event_time: string
  new_parts: number
  merges: number
  mutations: number
  removals: number
  [key: string]: unknown
}

const LIFECYCLE_SERIES = [
  { key: 'new_parts', color: TONE_COLOR.green },
  { key: 'merges', color: TONE_COLOR.violet },
  { key: 'mutations', color: TONE_COLOR.amber },
  { key: 'removals', color: TONE_COLOR.rose },
] as const

export function LifecycleChart({
  data,
  height = 172,
}: {
  data: LifecyclePoint[]
  height?: number
}) {
  const w = 100
  const h = 100
  const totals = data.map(
    (d) => num(d.new_parts) + num(d.merges) + num(d.mutations) + num(d.removals)
  )
  const max = Math.max(...totals, 1)
  const slot = w / Math.max(data.length, 1)
  const bw = slot * 0.74
  const gap = slot * 0.26
  return (
    <div className="w-full" style={{ height }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="block size-full"
      >
        <title>Part lifecycle events by type, last 24 hours</title>
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
        {data.map((d, i) => {
          const x = i * slot + gap / 2
          let y = h - 4
          return (
            <g key={d.event_time || i}>
              {LIFECYCLE_SERIES.map((s) => {
                const hh = (num(d[s.key]) / max) * (h - 8)
                y -= hh
                return (
                  <rect
                    key={s.key}
                    x={x}
                    y={y}
                    width={bw}
                    height={hh}
                    fill={s.color}
                    opacity="0.9"
                    rx="0.3"
                  />
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ───────────────────────── donut ─────────────────────────

export interface DonutSegment {
  label: string
  value: number
  color: string
}

export function Donut({
  segments,
  size = 132,
  thickness = 16,
  center,
}: {
  segments: DonutSegment[]
  size?: number
  thickness?: number
  center?: { value: string; label: string }
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          stroke="currentColor"
          className="text-muted"
        />
        {segments.map((s) => {
          const len = (s.value / total) * c
          const el = (
            <circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={thickness}
              stroke={s.color}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          )
          offset += len
          return el
        })}
      </svg>
      {center && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[19px] font-bold leading-none tabular-nums">
            {center.value}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {center.label}
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────── churn bars ─────────────────────────

export function ChurnBars({
  rows,
}: {
  rows: { table: string; events: number; color: string }[]
}) {
  const max = Math.max(...rows.map((r) => r.events), 1)
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.table}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[11.5px]">
              <span
                className="size-1.5 shrink-0 rounded-sm"
                style={{ background: r.color }}
              />
              <span className="truncate">{r.table}</span>
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {formatReadableQuantity(r.events)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(r.events / max) * 100}%`,
                background: r.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ───────────────────────── size histogram ─────────────────────────

export function SizeHistogram({
  bins,
  height = 146,
}: {
  bins: number[]
  height?: number
}) {
  const w = 100
  const h = 100
  const max = Math.max(...bins, 1)
  const slot = w / Math.max(bins.length, 1)
  const bw = slot * 0.8
  const gap = slot * 0.2
  return (
    <div className="w-full" style={{ height }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="block size-full"
      >
        <title>Part size distribution</title>
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
        {bins.map((count, i) => {
          const hh = (count / max) * (h - 8)
          const x = i * slot + gap / 2
          const y = h - 4 - hh
          const fill =
            i <= 1
              ? TONE_COLOR.rose
              : i <= 3
                ? TONE_COLOR.amber
                : i <= 5
                  ? TONE_COLOR.blue
                  : TONE_COLOR.green
          return (
            <rect
              key={SIZE_BINS[i]?.label ?? i}
              x={x}
              y={y}
              width={bw}
              height={hh}
              fill={fill}
              opacity="0.88"
              rx="0.3"
            />
          )
        })}
      </svg>
    </div>
  )
}
