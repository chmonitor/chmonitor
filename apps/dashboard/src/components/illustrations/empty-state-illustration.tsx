import type { EmptyStateVariant } from '@/components/ui/empty-state'

import { cn } from '@/lib/utils'

/**
 * Bespoke ~40×40 mini-illustrations, one per {@link EmptyStateVariant}.
 *
 * These replace the single shared lucide glyph so each state reads distinctly
 * (empty tray vs. magnifier-over-nothing vs. severed plug vs. hourglass …)
 * while the surrounding circle frame + muted palette keep the system coherent
 * — we differentiate the illustration, not the chrome.
 *
 * Rules (see `docs/knowledge/product-design.md` › Illustrations):
 * - Token-driven only. Tone comes from `currentColor` (set by the caller's
 *   `text-*` class), never a raw hex/oklch or `hsl(var(--…))` literal.
 * - Motion-safe only: any animation is guarded by `motion-safe:` so it is
 *   inert under `prefers-reduced-motion` (never SMIL).
 * - Renders on both themes automatically because everything is `currentColor`
 *   plus semantic accents.
 */

type Props = { className?: string }

/** Shared <svg> chrome so every mini-illustration is 40×40, `currentColor`-driven. */
function Svg({ className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={cn('h-10 w-10', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** no-data — an empty inbox tray, lid open, nothing inside. */
function NoDataIllustration({ className }: Props) {
  return (
    <Svg className={className}>
      <path d="M7 22v9a2 2 0 0 0 2 2h22a2 2 0 0 0 2-2v-9" />
      <path d="M7 22 11 9a2 2 0 0 1 1.9-1.4h14.2A2 2 0 0 1 29 9l4 13" />
      <path d="M7 22h7l2 3h8l2-3h7" />
      <circle cx="20" cy="15" r="0.6" className="opacity-40" />
      <circle cx="16" cy="16" r="0.6" className="opacity-40" />
      <circle cx="24" cy="16" r="0.6" className="opacity-40" />
    </Svg>
  )
}

/** no-results — a magnifier hovering over a dashed void. */
function NoResultsIllustration({ className }: Props) {
  return (
    <Svg className={className}>
      <circle cx="8" cy="30" r="1" className="opacity-40" />
      <circle cx="14" cy="33" r="1" className="opacity-40" />
      <circle cx="20" cy="31" r="1" className="opacity-40" />
      <circle cx="18" cy="17" r="8.5" />
      <path d="m24.5 23.5 6.5 6.5" />
      <path d="M14 17h8" className="opacity-60" strokeDasharray="1.5 3" />
    </Svg>
  )
}

/** error — a server unit with a fault spark. */
function ErrorIllustration({ className }: Props) {
  return (
    <Svg className={className}>
      <rect x="8" y="8" width="24" height="9" rx="2" />
      <rect x="8" y="23" width="24" height="9" rx="2" />
      <path d="M12 12.5h.01M12 27.5h.01" />
      <path
        d="M27 9.5 24 15h4l-3 5.5"
        className="text-destructive"
        strokeWidth={1.75}
      />
    </Svg>
  )
}

/** loading — a broken ring that spins (motion-safe). */
function LoadingIllustration({ className }: Props) {
  return (
    <Svg className={className}>
      <circle cx="20" cy="20" r="11" className="opacity-25" />
      <path
        d="M20 9a11 11 0 0 1 11 11"
        className="origin-center motion-safe:animate-spin"
        strokeWidth={2}
      />
    </Svg>
  )
}

/** offline — a severed plug: two connector halves pulled apart. */
function OfflineIllustration({ className }: Props) {
  return (
    <Svg className={className}>
      <path d="M6 20h6" />
      <path d="M12 15v10a4 4 0 0 0 4 4h1" />
      <path d="M34 20h-6" />
      <path d="M28 15v10a4 4 0 0 1-4 4h-1" />
      <path d="M16 12v3M24 12v3" />
      <path d="M18 20h1.5M20.5 20H22" className="text-warning" />
    </Svg>
  )
}

/** table-missing — a database stack with a dashed, absent middle ring. */
function TableMissingIllustration({ className }: Props) {
  return (
    <Svg className={className}>
      <ellipse cx="20" cy="11" rx="11" ry="4" />
      <path d="M9 11v6c0 2.2 4.9 4 11 4s11-1.8 11-4v-6" />
      <path
        d="M9 20v6c0 2.2 4.9 4 11 4s11-1.8 11-4v-6"
        strokeDasharray="2 3"
        className="opacity-60"
      />
    </Svg>
  )
}

/** timeout — an hourglass mid-drain. */
function TimeoutIllustration({ className }: Props) {
  return (
    <Svg className={className}>
      <path d="M12 8h16M12 32h16" strokeWidth={1.75} />
      <path d="M13 8c0 6 7 8 7 12s-7 6-7 12" />
      <path d="M27 8c0 6-7 8-7 12s7 6 7 12" />
      <path d="M16 30h8" className="text-warning" strokeWidth={2} />
      <path d="M20 20v6" className="text-warning opacity-70" />
    </Svg>
  )
}

/** filtered-empty — a funnel with nothing coming through. */
function FilteredEmptyIllustration({ className }: Props) {
  return (
    <Svg className={className}>
      <path d="M8 10h24l-9 10v9l-6 3v-12L8 10Z" />
      <path d="M20 30v4" strokeDasharray="1.5 3" className="opacity-50" />
      <circle cx="20" cy="36" r="1" className="opacity-40" />
    </Svg>
  )
}

const BY_VARIANT: Record<EmptyStateVariant, (p: Props) => React.ReactNode> = {
  'no-data': NoDataIllustration,
  'no-results': NoResultsIllustration,
  error: ErrorIllustration,
  loading: LoadingIllustration,
  offline: OfflineIllustration,
  'table-missing': TableMissingIllustration,
  timeout: TimeoutIllustration,
  'filtered-empty': FilteredEmptyIllustration,
}

/** Default tone (a `text-*` class) applied to each variant's illustration. */
const TONE_BY_VARIANT: Record<EmptyStateVariant, string> = {
  'no-data': 'text-muted-foreground/70',
  'no-results': 'text-muted-foreground/70',
  error: 'text-destructive/70',
  loading: 'text-muted-foreground/70',
  offline: 'text-warning/70',
  'table-missing': 'text-muted-foreground/70',
  timeout: 'text-warning/70',
  'filtered-empty': 'text-muted-foreground/70',
}

/**
 * Renders the bespoke mini-illustration for a given EmptyState variant.
 * Pass `className` to override the default tone (e.g. a smaller size).
 */
export function EmptyStateIllustration({
  variant,
  className,
}: {
  variant: EmptyStateVariant
  className?: string
}) {
  const Component = BY_VARIANT[variant]
  return <Component className={cn(TONE_BY_VARIANT[variant], className)} />
}
