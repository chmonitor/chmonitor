// NOTE: intentionally NOT a 'use client' module. This component is purely
// presentational (no hooks, state, or event handlers), so it is a shared
// component that renders on either side of the boundary. Crucially, that lets
// `createConfigExpandedDetails()` be CALLED from server modules (the query-config
// registry is imported by API routes); a 'use client' module's exports become
// client references that throw when invoked on the server.

import { InfoIcon } from 'lucide-react'

import type { ExpandedRenderer } from '@/types/query-config'

/**
 * Generic expanded-row renderer for "config"-style tables (system.settings,
 * system.merge_tree_settings, system.users, …). These tables fetch many more
 * columns than the table comfortably shows; this panel surfaces the rest as a
 * readable key/value grid plus the full (untruncated) description on top.
 *
 * Use {@link createConfigExpandedDetails} from a QueryConfig:
 *
 *   expandable: {
 *     renderExpanded: createConfigExpandedDetails({
 *       primaryColumns: SETTINGS_COLUMNS,
 *     }),
 *   }
 */

interface CreateConfigExpandedDetailsOptions {
  primaryColumns?: readonly string[]
  descriptionKey?: string
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

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-background/60 px-3 py-2">
      <div className="truncate text-[11px] max-sm:text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className="mt-1 min-w-0 truncate font-mono text-sm tabular-nums text-foreground"
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

interface ConfigExpandedDetailsProps
  extends CreateConfigExpandedDetailsOptions {
  row: Record<string, unknown>
}

export function ConfigExpandedDetails({
  row,
  primaryColumns = [],
  descriptionKey = 'description',
}: ConfigExpandedDetailsProps) {
  const description = row[descriptionKey]
  const skip = new Set<string>([...primaryColumns, descriptionKey])

  const entries = Object.entries(row).filter(
    ([key, value]) => !skip.has(key) && hasValue(value)
  )

  if (!hasValue(description) && entries.length === 0) {
    return (
      <div className="border-t border-border/60 bg-muted/20 p-4 text-xs text-muted-foreground">
        No additional details.
      </div>
    )
  }

  return (
    <div
      data-slot="config-expanded"
      className="space-y-3 border-t border-border/60 bg-muted/20 p-4"
    >
      {hasValue(description) && (
        <div className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0">{formatValue(description)}</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entries.map(([key, value]) => (
            <DetailField
              key={key}
              label={humanizeKey(key)}
              value={formatValue(value)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function createConfigExpandedDetails(
  options: CreateConfigExpandedDetailsOptions = {}
): ExpandedRenderer {
  return (row) => (
    <ConfigExpandedDetails row={row as Record<string, unknown>} {...options} />
  )
}
