import { cn } from '@/lib/utils'

/**
 * Hero illustration for the first-run welcome / setup screen — the literal
 * first impression after signup or install. A ClickHouse cluster (three stacked
 * nodes) streaming metrics into a monitoring panel that shows a live sparkline
 * with an emerald "live" pulse.
 *
 * Token-driven + motion-safe only (see `docs/knowledge/product-design.md` ›
 * Illustrations): brand orange for the metric line, emerald for the live dot,
 * chart palette for the bars, `currentColor`/semantic tokens for chrome. The
 * streaming dots + live pulse are guarded by `motion-safe:` (no SMIL).
 */
export function WelcomeIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 96"
      className={cn('h-24 w-30', className)}
      fill="none"
      role="img"
      aria-label="ClickHouse cluster streaming metrics into a monitoring dashboard"
    >
      {/* Cluster nodes (left) */}
      <g className="text-muted-foreground">
        {[26, 48, 70].map((cy) => (
          <g key={cy}>
            <ellipse
              cx="24"
              cy={cy}
              rx="13"
              ry="4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="opacity-70"
            />
            <path
              d={`M11 ${cy} v8 c0 2.2 5.8 4 13 4 s13 -1.8 13 -4 v-8`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="opacity-70"
            />
          </g>
        ))}
      </g>

      {/* Streaming connector cluster → panel */}
      <g className="text-border">
        <line
          x1="40"
          y1="48"
          x2="62"
          y2="48"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray="2 3"
          strokeLinecap="round"
        />
        <circle
          cx="40"
          cy="48"
          r="1.8"
          className="fill-orange-500 motion-safe:animate-flow-stream"
        />
        <circle
          cx="40"
          cy="48"
          r="1.8"
          className="fill-orange-500 motion-safe:animate-flow-stream"
          style={{ animationDelay: '1.1s' }}
        />
      </g>

      {/* Monitoring panel (right) */}
      <rect
        x="62"
        y="20"
        width="50"
        height="56"
        rx="6"
        className="fill-card stroke-border"
        strokeWidth={1.5}
      />
      {/* Panel header + live dot */}
      <line
        x1="62"
        y1="32"
        x2="112"
        y2="32"
        className="stroke-border"
        strokeWidth={1}
      />
      <circle
        cx="69"
        cy="26"
        r="2"
        className="fill-emerald-500 motion-safe:animate-pulse motion-reduce:animate-none"
      />
      <rect
        x="76"
        y="24.5"
        width="20"
        height="3"
        rx="1.5"
        className="fill-muted"
      />

      {/* Metric sparkline */}
      <path
        d="M68 62 L76 54 L82 58 L90 44 L98 50 L106 40"
        fill="none"
        className="stroke-orange-500"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="106" cy="40" r="2.2" className="fill-orange-500" />

      {/* Mini bars */}
      <rect
        x="68"
        y="68"
        width="6"
        height="4"
        rx="1"
        className="fill-chart-1"
      />
      <rect
        x="78"
        y="66"
        width="6"
        height="6"
        rx="1"
        className="fill-chart-2"
      />
      <rect
        x="88"
        y="69"
        width="6"
        height="3"
        rx="1"
        className="fill-chart-3"
      />
      <rect
        x="98"
        y="67"
        width="6"
        height="5"
        rx="1"
        className="fill-chart-4"
      />
    </svg>
  )
}
