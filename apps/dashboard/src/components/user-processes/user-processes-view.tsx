import { Timer } from 'lucide-react'

import { useMemo } from 'react'
import { PageLayout } from '@/components/layout/query-page'
import { useTimeRange } from '@/lib/context/time-range-context'
import { usePathname, useRouter, useSearchParams } from '@/lib/next-compat'
import { userProcessesConfig } from '@/lib/query-config/tables/user-processes'
import { cn } from '@/lib/utils'

/** Presets that drive the dynamic `last_hours` window, from the query config. */
const PRESETS = userProcessesConfig.filterParamPresets ?? []

/**
 * A single-select chip group bound to the `last_hours` filter param — the same
 * pattern used by the slow-queries / expensive-queries views. Selecting a chip
 * rewrites the URL, which re-fetches the table with the new window so the
 * historical columns recompute.
 */
function FilterGroup({
  groupKey,
  active,
  onSelect,
}: {
  groupKey: string
  active: string
  onSelect: (key: string, value: string) => void
}) {
  const options = PRESETS.filter((p) => p.key === groupKey)
  if (options.length === 0) return null
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <Timer className="size-3.5" />
        Time window
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {options.map((opt) => {
          const selected = active === String(opt.value)
          return (
            <button
              key={`${opt.key}-${opt.value}`}
              type="button"
              onClick={() => onSelect(opt.key, String(opt.value))}
              className={cn(
                'rounded-md border px-2 py-1 text-[11px] font-medium tabular-nums transition-colors',
                selected
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              )}
            >
              {opt.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * UserProcessesView — the User Processes page.
 *
 * A dynamic time-window preset bar over the generic {@link PageLayout} table.
 * The active window (URL `last_hours` param, seeded from the global time-range
 * picker, default 24h) is passed to the table as a search param so the
 * per-user `system.query_log` aggregate recomputes. The live `system.processes`
 * columns are unaffected by the window.
 */
export function UserProcessesView() {
  const { timeRange } = useTimeRange()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // URL param wins; otherwise seed from the global picker (defaults to 24h).
  const lastHours =
    searchParams.get('last_hours') ?? String(timeRange.lastHours)

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    next.set(key, value)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  const tableSearchParams = useMemo(
    () => ({ last_hours: lastHours }),
    [lastHours]
  )

  const activePreset = PRESETS.find((p) => String(p.value) === lastHours)
  const windowLabel =
    activePreset?.name.replace(/^Last /, '') ?? `${lastHours}h`

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-3 py-2.5">
        <FilterGroup
          groupKey="last_hours"
          active={lastHours}
          onSelect={setFilter}
        />
      </div>

      <PageLayout
        queryConfig={userProcessesConfig}
        title="User Processes"
        description={`Per-user live queries and historical activity over the last ${windowLabel}`}
        searchParams={tableSearchParams}
      />
    </div>
  )
}
