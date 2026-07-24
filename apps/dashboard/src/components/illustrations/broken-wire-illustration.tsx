import type { ConnectionErrorKind } from '@/lib/connection-errors'

import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
import { cn } from '@/lib/utils'

/**
 * A "broken wire" flow diagram for a failed connection test: the same
 * browser → chmonitor → source path as `connection-help-panel.tsx`'s
 * `FlowConnector`, but with the failed segment severed and X-marked so the
 * user sees *which hop* broke, not just reads about it.
 *
 * Two failure geometries, derived from the classified {@link ConnectionErrorKind}:
 * - `link`   — chmonitor could not reach the source at all (DNS, refused, TLS,
 *   timeout, invalid URL, host-not-allowed). The chmonitor→source wire is cut.
 * - `source` — the source was reached but rejected us (auth, permissions,
 *   missing database). The wire is intact; the source node carries the fault.
 *
 * Token-driven + motion-safe only (see `docs/knowledge/product-design.md` ›
 * Illustrations): the intact wire streams under `motion-safe:`; the destructive
 * accent is `text-destructive`; everything else is `currentColor`.
 */

type Geometry = 'link' | 'source'

function geometryFor(kind: ConnectionErrorKind): Geometry {
  switch (kind) {
    case 'auth_failed':
    case 'access_denied':
    case 'database_not_found':
      return 'source'
    default:
      // host_not_allowed, invalid_url, dns_error, connection_refused,
      // tls_error, timeout, unknown — the source was never reached.
      return 'link'
  }
}

/** A small node tile (browser / chmonitor / source). */
function Node({
  x,
  children,
  faulted = false,
}: {
  x: number
  children: React.ReactNode
  faulted?: boolean
}) {
  return (
    <foreignObject x={x} y={10} width={28} height={28}>
      <div
        className={cn(
          'flex size-7 items-center justify-center rounded-lg border bg-background',
          faulted ? 'border-destructive/50' : 'border-border'
        )}
      >
        {children}
      </div>
    </foreignObject>
  )
}

/** A dashed connector; `broken` cuts it with a gap + red X, else it streams. */
function Wire({ x, broken }: { x: number; broken: boolean }) {
  if (broken) {
    return (
      <g className="text-destructive">
        <line
          x1={x}
          y1={24}
          x2={x + 8}
          y2={24}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <line
          x1={x + 16}
          y1={24}
          x2={x + 24}
          y2={24}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <path
          d={`M${x + 10} 21 l4 6 M${x + 14} 21 l-4 6`}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </g>
    )
  }
  return (
    <g className="text-border">
      <line
        x1={x}
        y1={24}
        x2={x + 24}
        y2={24}
        stroke="currentColor"
        strokeWidth={1.5}
        strokeDasharray="2 3"
        strokeLinecap="round"
      />
      <circle
        cx={x}
        cy={24}
        r={1.6}
        className="fill-orange-500 motion-safe:animate-flow-stream"
      />
    </g>
  )
}

export function BrokenWireIllustration({
  kind,
  className,
}: {
  kind: ConnectionErrorKind
  className?: string
}) {
  const geometry = geometryFor(kind)
  return (
    <svg
      viewBox="0 0 160 48"
      className={cn('h-12 w-40', className)}
      fill="none"
      role="img"
      aria-label={
        geometry === 'link'
          ? 'Connection diagram: chmonitor could not reach the source'
          : 'Connection diagram: source reached but rejected the connection'
      }
    >
      {/* browser → chmonitor : always intact (you are already in the app). */}
      <Wire x={30} broken={false} />
      {/* chmonitor → source : broken only for reachability failures. */}
      <Wire x={102} broken={geometry === 'link'} />

      <Node x={2}>
        <svg
          viewBox="0 0 24 24"
          className="size-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M3 9h18" />
        </svg>
      </Node>

      <Node x={66}>
        <ChmonitorLogo width={16} height={16} />
      </Node>

      <Node x={130} faulted={geometry === 'source'}>
        <svg
          viewBox="0 0 24 24"
          className={cn(
            'size-4',
            geometry === 'source' ? 'text-destructive' : 'text-muted-foreground'
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
          <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
        </svg>
      </Node>
    </svg>
  )
}
