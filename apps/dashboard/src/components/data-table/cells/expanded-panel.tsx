// NOTE: intentionally NOT a 'use client' module. Like
// `config-expanded-details.tsx`, this is purely presentational (no hooks,
// state, or event handlers) so `createExpandedPanel()` can be CALLED from the
// query-config registry, which is imported by server-side API routes. A
// 'use client' module's exports become client references that throw on the
// server.

import { Code2Icon } from 'lucide-react'

import type { Icon } from '@chm/types/icon'
import type { ExpandedRenderer } from '@/types/query-config'

import { cn } from '@/lib/utils'

/**
 * Declarative, rich expanded-row panels — the config-driven counterpart to the
 * bespoke running-queries `ExpandedRow`. A page composes a detail panel from
 * sections instead of hand-writing JSX:
 *
 * ```ts
 * expandable: {
 *   renderExpanded: createExpandedPanel({
 *     sections: [
 *       { type: 'stats', columns: [{ key: 'query_duration', label: 'Duration' }] },
 *       { type: 'bars', columns: [{ key: 'memory_usage', label: 'Memory', pctKey: 'pct_memory_usage' }] },
 *       { type: 'fields', title: 'Identity', columns: ['query_id', 'user', 'client_name'] },
 *       { type: 'code', title: 'Full query', column: 'query' },
 *     ],
 *   }),
 * }
 * ```
 */

export type ExpandedField = string | { key: string; label?: string }

export interface ExpandedStat {
  key: string
  label?: string
  readableKey?: string
  icon?: Icon
}

export interface ExpandedBar {
  key: string
  label?: string
  readableKey?: string
  pctKey?: string
}

export type ExpandedSection =
  | {
      type: 'fields'
      title?: string
      columns: ReadonlyArray<ExpandedField>
      cols?: 2 | 3 | 4 | 5
    }
  | { type: 'stats'; title?: string; columns: ReadonlyArray<ExpandedStat> }
  | { type: 'bars'; title?: string; columns: ReadonlyArray<ExpandedBar> }
  | { type: 'code'; title?: string; column: string }

export interface CreateExpandedPanelOptions {
  sections: ReadonlyArray<ExpandedSection>
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : value.map((v) => String(v)).join(', ')
  }
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function displayValue(
  row: Record<string, unknown>,
  key: string,
  readableKey?: string
): string {
  const rk = readableKey ?? `readable_${key}`
  if (hasValue(row[rk])) return formatValue(row[rk])
  if (hasValue(row[key])) return formatValue(row[key])
  return '—'
}

function toPct(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

/**
 * Whether a section has any data to render for this row. Needed because the
 * empty-state must be decided from the DATA, not from the rendered element list
 * — React elements are always truthy, so a `.filter(Boolean)` over rendered
 * sections never empties even when every section renders nothing.
 */
function sectionHasData(
  section: ExpandedSection,
  row: Record<string, unknown>
): boolean {
  switch (section.type) {
    case 'code':
      return hasValue(row[section.column])
    case 'fields':
      return section.columns.some((field) => {
        const key = typeof field === 'string' ? field : field.key
        return hasValue(row[key]) || hasValue(row[`readable_${key}`])
      })
    case 'stats':
      return section.columns.some(
        (stat) =>
          hasValue(row[stat.key]) ||
          hasValue(row[stat.readableKey ?? `readable_${stat.key}`])
      )
    case 'bars':
      return section.columns.some(
        (bar) =>
          hasValue(row[bar.key]) ||
          hasValue(row[bar.readableKey ?? `readable_${bar.key}`])
      )
    default:
      return false
  }
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] max-sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

const GRID_COLS: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  5: 'sm:grid-cols-3 lg:grid-cols-5',
}

function FieldsSection({
  section,
  row,
}: {
  section: Extract<ExpandedSection, { type: 'fields' }>
  row: Record<string, unknown>
}) {
  const fields = section.columns
    .map((field) =>
      typeof field === 'string'
        ? { key: field, label: humanizeKey(field) }
        : { key: field.key, label: field.label ?? humanizeKey(field.key) }
    )
    .filter(
      (field) =>
        hasValue(row[field.key]) || hasValue(row[`readable_${field.key}`])
    )

  if (!fields.length) return null

  return (
    <div>
      {section.title && <SectionTitle>{section.title}</SectionTitle>}
      <div
        className={cn('grid grid-cols-1 gap-2', GRID_COLS[section.cols ?? 4])}
      >
        {fields.map((field) => {
          const value = displayValue(row, field.key)
          return (
            <div
              key={field.key}
              className="min-w-0 rounded-md border border-border/60 bg-background/60 px-3 py-2"
            >
              <div className="truncate text-[10px] max-sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {field.label}
              </div>
              <div
                className="mt-0.5 min-w-0 truncate font-mono text-[12.5px] tabular-nums text-foreground"
                title={value}
              >
                {value}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatsSection({
  section,
  row,
}: {
  section: Extract<ExpandedSection, { type: 'stats' }>
  row: Record<string, unknown>
}) {
  const stats = section.columns.filter(
    (stat) =>
      hasValue(row[stat.key]) ||
      hasValue(row[stat.readableKey ?? `readable_${stat.key}`])
  )
  if (!stats.length) return null

  return (
    <div>
      {section.title && <SectionTitle>{section.title}</SectionTitle>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map((stat) => {
          const StatIcon = stat.icon
          const value = displayValue(row, stat.key, stat.readableKey)
          return (
            <div
              key={stat.key}
              className="min-w-0 rounded-md border border-border/60 bg-background/60 px-3 py-2.5"
            >
              <div className="flex items-center gap-1 text-[10px] max-sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {StatIcon && <StatIcon className="size-3 shrink-0" />}
                <span className="truncate">
                  {stat.label ?? humanizeKey(stat.key)}
                </span>
              </div>
              <div
                className="mt-1 truncate text-lg font-semibold leading-none tabular-nums text-foreground"
                title={value}
              >
                {value}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BarsSection({
  section,
  row,
}: {
  section: Extract<ExpandedSection, { type: 'bars' }>
  row: Record<string, unknown>
}) {
  const bars = section.columns.filter(
    (bar) =>
      hasValue(row[bar.key]) ||
      hasValue(row[bar.readableKey ?? `readable_${bar.key}`])
  )
  if (!bars.length) return null

  return (
    <div>
      {section.title && <SectionTitle>{section.title}</SectionTitle>}
      <div className="space-y-2">
        {bars.map((bar) => {
          const value = displayValue(row, bar.key, bar.readableKey)
          const pct = toPct(row[bar.pctKey ?? `pct_${bar.key}`])
          return (
            <div key={bar.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">
                  {bar.label ?? humanizeKey(bar.key)}
                </span>
                <span
                  className="shrink-0 font-mono tabular-nums text-foreground"
                  title={value}
                >
                  {value}
                </span>
              </div>
              <div
                className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={bar.label ?? humanizeKey(bar.key)}
              >
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CodeSection({
  section,
  row,
}: {
  section: Extract<ExpandedSection, { type: 'code' }>
  row: Record<string, unknown>
}) {
  const raw = row[section.column]
  if (!hasValue(raw)) return null
  const text = String(raw)
  const lineCount = (text.match(/\n/g)?.length ?? 0) + 1

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] max-sm:text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Code2Icon className="size-3 shrink-0" />
          {section.title ?? humanizeKey(section.column)}
        </span>
        <span className="whitespace-nowrap text-[10.5px] max-sm:text-xs tabular-nums text-muted-foreground">
          {text.length.toLocaleString()} chars
          <span className="mx-1.5 opacity-50">·</span>
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
      </div>
      <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-background/60 px-3 py-2 font-mono text-[11.5px] max-sm:text-xs leading-relaxed text-foreground">
        {text}
      </pre>
    </div>
  )
}

interface ExpandedPanelProps extends CreateExpandedPanelOptions {
  row: Record<string, unknown>
}

export function ExpandedPanel({ sections, row }: ExpandedPanelProps) {
  // Keep only sections that actually have data for this row, so the empty-state
  // is reachable (see `sectionHasData`).
  const visible = sections.filter((section) => sectionHasData(section, row))

  if (!visible.length) {
    return (
      <div className="text-xs text-muted-foreground">
        No additional details.
      </div>
    )
  }

  return (
    <div data-slot="expanded-panel" className="space-y-3.5">
      {visible.map((section, index) => {
        const key = `${section.type}-${index}`
        switch (section.type) {
          case 'fields':
            return <FieldsSection key={key} section={section} row={row} />
          case 'stats':
            return <StatsSection key={key} section={section} row={row} />
          case 'bars':
            return <BarsSection key={key} section={section} row={row} />
          case 'code':
            return <CodeSection key={key} section={section} row={row} />
          default:
            return null
        }
      })}
    </div>
  )
}

export function createExpandedPanel(
  options: CreateExpandedPanelOptions
): ExpandedRenderer {
  return (row) => (
    <ExpandedPanel
      sections={options.sections}
      row={row as Record<string, unknown>}
    />
  )
}
