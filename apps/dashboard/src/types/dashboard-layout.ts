/**
 * Custom dashboard grid layout model (plan 57).
 *
 * Grid coordinate system — the contract plan 59 ("AI-generated dashboards")
 * will target when it programmatically builds a `DashboardLayout`:
 *
 *   - `GRID_COLUMNS` (12) fixed-width columns spanning the dashboard's full
 *     content width, laid out with CSS Grid (`grid-template-columns:
 *     repeat(12, 1fr)`). There is no fixed pixel column width — columns are
 *     fractional (`1fr`) and resize with the viewport; only the row height
 *     is a fixed pixel value.
 *   - `x`/`y` are 0-based grid-cell coordinates (`x` is a column index in
 *     `[0, GRID_COLUMNS)`, `y` is a row index starting at 0, growing
 *     downward with no fixed maximum).
 *   - `w`/`h` are the widget's span in columns/rows. `w` must satisfy
 *     `MIN_WIDGET_W <= w <= GRID_COLUMNS - x` (never wider than the grid).
 *     `h` must satisfy `h >= MIN_WIDGET_H` (no fixed max row count).
 *   - Rows are `GRID_ROW_HEIGHT_PX` tall (plus `GRID_GAP_PX` gutters between
 *     cells), giving every widget a deterministic pixel size from its grid
 *     span alone.
 *   - **Collision rule**: no two widgets in the same layout may occupy an
 *     overlapping `(x, y, w, h)` rectangle. Layout producers (the arrange-mode
 *     grid UI, and — later — plan 59's generator) must place each new/moved
 *     widget in a rectangle that does not intersect any other widget's
 *     rectangle. `normalizeLayout` does NOT resolve collisions on load (it
 *     trusts previously-saved layouts); the arrange-mode grid UI is
 *     responsible for rejecting a move/resize that would create one (see
 *     `components/dashboard/grid.tsx`).
 */

/** Fixed column count for the dashboard grid. */
export const GRID_COLUMNS = 12
/** Pixel height of a single grid row (excludes the gap). */
export const GRID_ROW_HEIGHT_PX = 90
/** Pixel gap between grid cells (both axes). */
export const GRID_GAP_PX = 12
/** Minimum widget width, in grid columns. */
export const MIN_WIDGET_W = 2
/** Minimum widget height, in grid rows. */
export const MIN_WIDGET_H = 2
/** Default chart widget size — two per row, matching the legacy 2-col CSS grid. */
export const DEFAULT_CHART_WIDGET_W = 6
export const DEFAULT_CHART_WIDGET_H = 4

export type WidgetType = 'chart' | 'table' | 'stat' | 'text'

const WIDGET_TYPES: readonly WidgetType[] = ['chart', 'table', 'stat', 'text']

export interface DashboardWidget {
  /** Stable widget instance id (crypto.randomUUID()). */
  id: string
  type: WidgetType
  /** For type: 'chart' — a registry key from `getChartComponent`. */
  chartName?: string
  /** For type: 'table' — a query-config name, resolved via `getQueryConfigByName`. */
  queryConfigName?: string
  /** Optional title override (required in practice for 'stat' | 'text'). */
  title?: string
  /** 0-based grid column position. */
  x: number
  /** 0-based grid row position. */
  y: number
  /** Width in grid columns. */
  w: number
  /** Height in grid rows. */
  h: number
  /**
   * Widget-specific extras. `type: 'text'` uses `{ markdown: string }`.
   * `type: 'stat'` uses `{ statQuery: string, statLabel?: string }`.
   */
  props?: Record<string, unknown>
}

export interface DashboardLayout {
  widgets: DashboardWidget[]
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1
}

/**
 * Type guard for a single widget. Deliberately strict on required geometry
 * fields (a widget with garbage coordinates is worse than no widget), but
 * permissive on the widget-specific `chartName`/`queryConfigName`/`props` —
 * those are validated by the consuming widget renderer (e.g. an unknown
 * `chartName` just renders nothing, same as today's `hasChart` guard).
 */
export function isValidWidget(w: unknown): w is DashboardWidget {
  if (!w || typeof w !== 'object') return false
  const rec = w as Record<string, unknown>

  if (typeof rec.id !== 'string' || rec.id.length === 0) return false
  if (
    typeof rec.type !== 'string' ||
    !WIDGET_TYPES.includes(rec.type as WidgetType)
  )
    return false
  if (!isNonNegativeInt(rec.x) || !isNonNegativeInt(rec.y)) return false
  if (!isPositiveInt(rec.w) || !isPositiveInt(rec.h)) return false
  if (rec.w < MIN_WIDGET_W || rec.h < MIN_WIDGET_H) return false
  if (rec.x + rec.w > GRID_COLUMNS) return false
  if (rec.chartName !== undefined && typeof rec.chartName !== 'string')
    return false
  if (
    rec.queryConfigName !== undefined &&
    typeof rec.queryConfigName !== 'string'
  )
    return false
  if (rec.title !== undefined && typeof rec.title !== 'string') return false
  if (rec.props !== undefined) {
    if (typeof rec.props !== 'object' || rec.props === null) return false
  }

  return true
}

/** Auto-place `n` legacy chart widgets 2-per-row, matching the pre-plan-57 CSS grid. */
function legacyChartsToWidgets(chartNames: string[]): DashboardWidget[] {
  return chartNames.map((chartName, i) => ({
    id: `legacy-${i}-${chartName}`,
    type: 'chart' as const,
    chartName,
    x: (i % 2) * DEFAULT_CHART_WIDGET_W,
    y: Math.floor(i / 2) * DEFAULT_CHART_WIDGET_H,
    w: DEFAULT_CHART_WIDGET_W,
    h: DEFAULT_CHART_WIDGET_H,
  }))
}

/**
 * Normalizes arbitrary persisted/loaded input into a `DashboardLayout`.
 * Never throws — falls back to `{ widgets: [] }` for anything unparseable,
 * so a corrupt or unrecognized payload degrades to an empty dashboard rather
 * than crashing the page.
 *
 * Accepts three shapes:
 *   1. The current `DashboardLayout` shape (`{ widgets: DashboardWidget[] }`)
 *      — invalid widgets inside `widgets` are dropped individually rather
 *      than failing the whole layout.
 *   2. The legacy pre-plan-57 shape: a bare `string[]` of chart names —
 *      converted to one `type: 'chart'` widget per name, auto-positioned
 *      2-per-row (see `legacyChartsToWidgets`), so every dashboard saved
 *      before this change keeps loading correctly with zero data loss.
 *   3. Anything else (null, wrong shape, etc.) — `{ widgets: [] }`.
 */
export function normalizeLayout(input: unknown): DashboardLayout {
  if (Array.isArray(input)) {
    if (input.every((c) => typeof c === 'string')) {
      return { widgets: legacyChartsToWidgets(input as string[]) }
    }
    return { widgets: [] }
  }

  if (input && typeof input === 'object') {
    const rec = input as Record<string, unknown>
    if (Array.isArray(rec.widgets)) {
      return { widgets: rec.widgets.filter(isValidWidget) }
    }
  }

  return { widgets: [] }
}

/**
 * True if `candidate`'s rectangle overlaps any *other* widget's rectangle
 * (a widget never collides with itself — matched by `id`). Implements the
 * collision rule documented above. Shared by the arrange-mode grid (to
 * reject an invalid move/resize) and `findFreePosition` (to place a newly
 * added widget) — and available to plan 59's layout generator so it can
 * validate a programmatically-built layout against the same rule.
 */
export function widgetsCollide(
  candidate: Pick<DashboardWidget, 'id' | 'x' | 'y' | 'w' | 'h'>,
  others: readonly DashboardWidget[]
): boolean {
  return others.some(
    (o) =>
      o.id !== candidate.id &&
      candidate.x < o.x + o.w &&
      candidate.x + candidate.w > o.x &&
      candidate.y < o.y + o.h &&
      candidate.y + candidate.h > o.y
  )
}

/**
 * Finds the first collision-free `(x, y)` for a new `w`×`h` widget among
 * `widgets`, scanning row-major (top-to-bottom, left-to-right) so widgets
 * pack tightly instead of always starting a new row. Falls back to a new
 * row below everything else if no gap is found within the existing extent
 * (which always succeeds, since an empty row has no collisions).
 */
export function findFreePosition(
  widgets: readonly DashboardWidget[],
  w: number,
  h: number
): { x: number; y: number } {
  const maxY = widgets.reduce((max, wi) => Math.max(max, wi.y + wi.h), 0)
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= GRID_COLUMNS - w; x++) {
      if (!widgetsCollide({ id: '__probe__', x, y, w, h }, widgets)) {
        return { x, y }
      }
    }
  }
  return { x: 0, y: maxY }
}
