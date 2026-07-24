import { cn } from '@/lib/utils'

/**
 * Hero illustration for the AI Agent greeting screen. The agent is the
 * product's differentiating feature, so it gets more than an 11px sparkle: a
 * chat orbit with a primary sparkle and satellite stars, over a rounded tile.
 *
 * Token-driven + motion-safe only (see `docs/knowledge/product-design.md` ›
 * Illustrations): brand orange + emerald accents, chart palette for the orbit
 * dots, `currentColor`/semantic tokens for chrome. The twinkle + orbit pulse
 * are guarded by `motion-safe:` (no SMIL).
 */
export function AgentGreetingIllustration({
  className,
}: {
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 96 96"
      className={cn('h-20 w-20', className)}
      fill="none"
      role="img"
      aria-label="AI agent ready to chat"
    >
      {/* Orbit ring */}
      <circle
        cx="48"
        cy="48"
        r="30"
        className="stroke-border"
        strokeWidth={1.5}
        strokeDasharray="2 4"
        fill="none"
      />

      {/* Chat tile */}
      <rect
        x="30"
        y="32"
        width="36"
        height="28"
        rx="8"
        className="fill-card stroke-border"
        strokeWidth={1.5}
      />
      <path
        d="M40 60 v6 l8 -6"
        className="fill-card stroke-border"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />

      {/* Primary sparkle */}
      <path
        d="M48 38 C49 43 50 44 55 45 C50 46 49 47 48 52 C47 47 46 46 41 45 C46 44 47 43 48 38 Z"
        className="fill-orange-500 motion-safe:animate-pulse motion-reduce:animate-none"
      />

      {/* Satellite stars on the orbit */}
      <circle cx="78" cy="48" r="2.5" className="fill-chart-2" />
      <circle cx="18" cy="48" r="2" className="fill-chart-4" />
      <circle
        cx="48"
        cy="18"
        r="2.2"
        className="fill-emerald-500 motion-safe:animate-pulse motion-reduce:animate-none"
      />
      <path
        d="M66 22 l1.4 2.8 3.1 .4 -2.2 2.2 .5 3 -2.8 -1.5 -2.8 1.5 .5 -3 -2.2 -2.2 3.1 -.4 Z"
        className="fill-chart-1"
      />
    </svg>
  )
}
