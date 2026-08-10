import type { ChNode, KeeperNode } from './model'

import { CH_R, KP_R, STATUS_COLOR } from './model'

export interface LiveMetrics {
  cpuPct: number | null
  memPct: number | null
}

// ── ClickHouse brand colors (theme-independent — the logo is self-colored) ──
const CH_YELLOW = '#FAFF00'
const CH_RED = '#FF1F00'

function clampPct(v: number): number {
  return Math.max(0, Math.min(1, v || 0))
}

/** Truncate an id so it fits inside the glyph; the full host shows below it. */
function fit(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/**
 * Bound a host label's width so long FQDNs
 * (`chi-...-0-0.clickhouse.svc.cluster.local`) don't sprawl past their cluster
 * boundary into neighbours — keeps the meaningful head + tail with a middle
 * ellipsis. ~24 chars ≈ the `chHalfExtent` the layout reserves. The full host is
 * still available on hover (a <title>) and in the inspector.
 */
function truncateMiddle(s: string, max = 24): string {
  if (s.length <= max) return s
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`
}

/**
 * The official ClickHouse logo mark, drawn in its native 9×8 unit grid then
 * scaled + centered at (0,0): four full-height yellow bars (x = 0,2,4,6), a red
 * square at the foot of the first bar, and a short bar at x = 8. Width `w`.
 */
function ChLogo({ w, muted }: { w: number; muted?: boolean }) {
  const s = w / 9 // unit size
  const h = 8 * s
  return (
    <g
      transform={`translate(${(-w / 2).toFixed(2)} ${(-h / 2).toFixed(2)}) scale(${s.toFixed(3)})`}
      opacity={muted ? 0.32 : 1}
      style={{ filter: muted ? 'grayscale(1)' : undefined }}
    >
      <rect x="0" y="7" width="1" height="1" fill={CH_RED} />
      <rect x="0" y="0" width="1" height="7" fill={CH_YELLOW} />
      <rect x="2" y="0" width="1" height="8" fill={CH_YELLOW} />
      <rect x="4" y="0" width="1" height="8" fill={CH_YELLOW} />
      <rect x="6" y="0" width="1" height="8" fill={CH_YELLOW} />
      <rect x="8" y="3.25" width="1" height="1.5" fill={CH_YELLOW} />
    </g>
  )
}

/** Pointy-top regular hexagon path of "radius" r centered at the origin. */
export function hexPath(r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90)
    pts.push(`${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`)
  }
  return `M ${pts.join(' L ')} Z`
}

/** A gently curved connector between two points — softer than a straight line.
 * The control point is offset perpendicular to the chord by a capped fraction
 * of its length, so every edge bows consistently. */
export function curvePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const bend = Math.min(46, len * 0.16)
  const cx = (x1 + x2) / 2 - (dy / len) * bend
  const cy = (y1 + y2) / 2 + (dx / len) * bend
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
}

/** A small keeper/coordination shield mark. */
const ShieldMark = ({ color }: { color: string }) => (
  <path
    transform="translate(0 -1)"
    d="M 0 -7 L 6.5 -3.6 v 5 c 0 4.4 -3.3 7.1 -6.5 8.2 c -3.2 -1.1 -6.5 -3.8 -6.5 -8.2 v -5 Z"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    opacity="0.8"
  />
)

// Shared label sub-line below a node glyph.
function NodeLabel({
  r,
  host,
  id,
  sub,
}: {
  r: number
  host: string
  id: string
  sub: string
}) {
  // Dedupe: the id is already shown inside the glyph; only repeat the full host
  // below when it carries more than the short id (e.g. an FQDN).
  const showHost = host !== id
  const subY = showHost ? r + 31 : r + 16
  return (
    <>
      {showHost && (
        <text
          textAnchor="middle"
          y={r + 16}
          fontSize="11.5"
          fontWeight="600"
          fill="var(--foreground)"
          stroke="var(--card)"
          strokeWidth="3"
          paintOrder="stroke"
          className="font-mono"
        >
          <title>{host}</title>
          {truncateMiddle(host)}
        </text>
      )}
      <text
        textAnchor="middle"
        y={subY}
        fontSize="10.5"
        fill="var(--muted-foreground)"
        stroke="var(--card)"
        strokeWidth="2.5"
        paintOrder="stroke"
        className="font-mono"
      >
        {sub}
      </text>
    </>
  )
}

export function ChGlyph({
  node,
  live,
  selected,
  dimmed,
  onSelect,
  onPointerDown,
}: {
  node: ChNode
  live: LiveMetrics | undefined
  selected: boolean
  dimmed: boolean
  onSelect: (id: string) => void
  /** Start a drag (node). Parent owns move/up listeners. */
  onPointerDown?: (e: React.PointerEvent, id: string) => void
}) {
  const r = CH_R
  const side = r * 2
  const statusCol = STATUS_COLOR[node.status]
  const unreachable = node.status === 'unreachable'
  const cpu = live?.cpuPct ?? null
  const meterCol =
    cpu !== null
      ? cpu > 85
        ? STATUS_COLOR.down
        : cpu > 60
          ? STATUS_COLOR.warn
          : 'hsl(217 91% 60%)'
      : statusCol
  const sub = unreachable
    ? 'unreachable'
    : cpu !== null
      ? `cpu ${Math.round(cpu)}%${
          live?.memPct !== null && live?.memPct !== undefined
            ? ` · mem ${Math.round(live.memPct)}%`
            : ''
        }`
      : node.errors > 0
        ? `${node.errors} error${node.errors === 1 ? '' : 's'}`
        : node.isLocal
          ? 'local node'
          : 'remote node'

  // CPU meter geometry (a thin bar inside the card's lower edge).
  const meterW = side - 24
  const meterPct = cpu !== null ? clampPct(cpu / 100) : 0
  const idText = fit(node.id, 13)

  return (
    <g
      transform={`translate(${node.x} ${node.y})`}
      tabIndex={0}
      role="button"
      aria-label={`ClickHouse node ${idText}`}
      onClick={(e) => {
        // When drag is wired, selection is decided on pointer-up in the canvas
        // (avoids toggle-twice: pointerup select + click select).
        if (onPointerDown) {
          e.stopPropagation()
          return
        }
        e.stopPropagation()
        onSelect(node.id)
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        onPointerDown?.(e, node.id)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onSelect(node.id)
        }
      }}
      style={{
        cursor: onPointerDown ? 'grab' : 'pointer',
        opacity: dimmed ? 0.25 : unreachable ? 0.72 : 1,
        transition: 'opacity .25s',
        outline: 'none',
      }}
    >
      {/* current (connected) node: a persistent breathing ring so the node this
          dashboard is talking to is always identifiable, independent of selection. */}
      {node.isLocal && (
        <rect
          className="topo-current-ring"
          x={-r - 5}
          y={-r - 5}
          width={side + 10}
          height={side + 10}
          rx="17"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
        />
      )}
      {/* G8 glass: soft selection glow (no hard double-ring stack). */}
      {selected && (
        <rect
          className="topo-select-glow"
          x={-r - 8}
          y={-r - 8}
          width={side + 16}
          height={side + 16}
          rx="18"
          fill="var(--primary)"
          fillOpacity="0.08"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeOpacity="0.55"
        />
      )}
      {/* Soft status wash under the glass card */}
      <rect
        x={-r}
        y={-r}
        width={side}
        height={side}
        rx="14"
        fill={statusCol}
        fillOpacity="0.12"
      />
      {/* Glass card — frosted fill, single status stroke (no stacked casing). */}
      <rect
        className="topo-glass-card"
        x={-r}
        y={-r}
        width={side}
        height={side}
        rx="14"
        fill="var(--card)"
        fillOpacity="0.72"
        stroke={statusCol}
        strokeOpacity={unreachable ? 0.75 : 0.9}
        strokeWidth="2.1"
        strokeDasharray={unreachable ? '4 4' : undefined}
      />
      {/* ClickHouse brand mark — instantly identifies a ClickHouse server */}
      <g transform={`translate(0 ${-r * 0.36})`}>
        <ChLogo w={r * 0.7} muted={unreachable} />
      </g>
      {/* short node id, inside the card */}
      <text
        textAnchor="middle"
        y={r * 0.42}
        fontSize="12"
        fontWeight="700"
        fill="var(--foreground)"
        className="font-mono"
      >
        {idText}
      </text>
      {/* live CPU meter along the card's lower edge */}
      <g transform={`translate(0 ${r - 11})`}>
        <rect
          x={-meterW / 2}
          y="0"
          width={meterW}
          height="3.5"
          rx="1.75"
          fill="var(--muted-foreground)"
          fillOpacity="0.18"
        />
        {cpu !== null && (
          <rect
            x={-meterW / 2}
            y="0"
            width={Math.max(2, meterW * meterPct)}
            height="3.5"
            rx="1.75"
            fill={meterCol}
            style={{ transition: 'width .6s ease' }}
          />
        )}
      </g>
      {/* status dot at the top-right corner */}
      <circle
        cx={r - 4}
        cy={-r + 4}
        r="5.5"
        fill={statusCol}
        stroke="var(--card)"
        strokeWidth="2"
      />
      <NodeLabel r={r} host={node.host} id={idText} sub={sub} />
      {node.isLocal && (
        <g transform={`translate(0 ${r + (node.host !== idText ? 40 : 25)})`}>
          <rect
            x="-22"
            y="0"
            width="44"
            height="15"
            rx="7.5"
            fill="var(--primary)"
            fillOpacity="0.12"
            stroke="var(--primary)"
            strokeOpacity="0.4"
            strokeWidth="1"
          />
          <text
            textAnchor="middle"
            y="10.5"
            fontSize="8.5"
            fontWeight="700"
            fill="var(--primary)"
            style={{ letterSpacing: '0.06em' }}
          >
            LOCAL
          </text>
        </g>
      )}
    </g>
  )
}

export function KeeperGlyph({
  node,
  selected,
  dimmed,
  onSelect,
  onPointerDown,
}: {
  node: KeeperNode
  selected: boolean
  dimmed: boolean
  onSelect: (id: string) => void
  onPointerDown?: (e: React.PointerEvent, id: string) => void
}) {
  const r = KP_R
  const isLeader = node.isLeader
  const statusCol = node.isConnected ? STATUS_COLOR.healthy : STATUS_COLOR.down
  const accent = isLeader ? STATUS_COLOR.warn : statusCol
  const sub = `${node.role} · ${node.avgLatency != null ? `${node.avgLatency.toFixed(1)}ms` : '—'}`
  const d = hexPath(r)
  const idText = fit(node.id, 11)

  return (
    <g
      transform={`translate(${node.x} ${node.y})`}
      tabIndex={0}
      role="button"
      aria-label={`Keeper node ${idText}`}
      onClick={(e) => {
        if (onPointerDown) {
          e.stopPropagation()
          return
        }
        e.stopPropagation()
        onSelect(node.id)
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        onPointerDown?.(e, node.id)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onSelect(node.id)
        }
      }}
      style={{
        cursor: onPointerDown ? 'grab' : 'pointer',
        opacity: dimmed ? 0.25 : 1,
        transition: 'opacity .25s',
        outline: 'none',
      }}
    >
      {selected && (
        <path
          className="topo-select-glow"
          d={hexPath(r + 7)}
          fill="var(--primary)"
          fillOpacity="0.08"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeOpacity="0.55"
        />
      )}
      {/* Soft glass wash */}
      <path d={d} fill={accent} fillOpacity="0.14" />
      {/* Glass hex body */}
      <path
        className="topo-glass-card"
        d={d}
        fill="var(--card)"
        fillOpacity="0.7"
        stroke={accent}
        strokeWidth={isLeader ? 2.4 : 2.1}
        strokeOpacity="0.9"
        strokeLinejoin="round"
      />
      {/* coordination shield in the upper band */}
      <g transform={`translate(0 ${-r * 0.44})`}>
        <ShieldMark color={accent} />
      </g>
      {/* node id, inside the wide middle band of the hexagon */}
      <text
        textAnchor="middle"
        y={r * 0.24}
        fontSize="11.5"
        fontWeight="700"
        fill="var(--foreground)"
        className="font-mono"
      >
        {idText}
      </text>
      {/* connection status dot at the upper-right vertex */}
      <circle
        cx={r * 0.72}
        cy={-r * 0.5}
        r="5"
        fill={statusCol}
        stroke="var(--card)"
        strokeWidth="2"
      />
      {isLeader && (
        <text
          textAnchor="middle"
          y={-r - 7}
          fontSize="15"
          fill={STATUS_COLOR.warn}
        >
          ★
        </text>
      )}
      <NodeLabel r={r} host={node.host} id={idText} sub={sub} />
    </g>
  )
}

/** A rounded label chip rendered over a hull so the name stays readable. Every
 * cluster — logical or physical — gets the same solid-bordered pill in its own
 * color; the physical/logical distinction lives in the toggle, not the pill. */
export function HullLabel({
  x,
  y,
  text,
  color,
}: {
  x: number
  y: number
  text: string
  color: string
}) {
  const h = 19
  const w = text.length * 7 + 20
  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* rect + text both centered on (x, y) so the label sits dead-center */}
      <rect
        className="topo-glass-card"
        x={x - w / 2}
        y={y - h / 2}
        width={w}
        height={h}
        rx={h / 2}
        fill="var(--card)"
        fillOpacity="0.78"
        stroke={color}
        strokeOpacity="0.55"
        strokeWidth="1.2"
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="11.5"
        fontWeight="700"
        fill={color}
        className="font-mono"
        style={{ letterSpacing: '0.01em' }}
      >
        {text}
      </text>
    </g>
  )
}
