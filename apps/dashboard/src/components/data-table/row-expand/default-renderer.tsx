/**
 * Default expanded-row content: a key/value grid of the row's fields.
 * Used when `queryConfig.expandable === true` and no custom renderer was
 * supplied. Keeps the JSON shape readable without dumping a raw blob.
 */
export function DefaultExpandedRow({ row }: { row: Record<string, unknown> }) {
  const entries = Object.entries(row)
  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground">Empty row</div>
  }
  return (
    <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="flex min-w-0 items-baseline gap-2 border-b border-border/30 py-1"
        >
          <span className="shrink-0 font-mono text-[11px] max-sm:text-xs uppercase tracking-wide text-muted-foreground">
            {key}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {renderValue(value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}
