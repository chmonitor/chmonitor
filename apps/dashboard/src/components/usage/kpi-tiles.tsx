import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export interface KpiTile {
  label: string
  value: string
}

interface KpiTilesProps {
  /** null while loading: renders `loadingCount` skeleton tiles. */
  tiles: KpiTile[] | null
  loadingCount: number
}

/** A row of label/value tiles, shared by the usage pages. */
export function KpiTiles({ tiles, loadingCount }: KpiTilesProps) {
  const count = tiles?.length ?? loadingCount
  const grid = cn(
    'grid grid-cols-2 gap-2',
    count > 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'
  )
  if (!tiles) {
    return (
      <div className={grid}>
        {Array.from({ length: loadingCount }, (_, i) => (
          <Skeleton key={i} className="h-[62px] rounded-lg" />
        ))}
      </div>
    )
  }
  return (
    <div className={grid}>
      {tiles.map((kpi) => (
        <div
          key={kpi.label}
          className="border-border/60 bg-card/40 flex min-w-0 flex-col rounded-lg border px-3 py-2"
        >
          <span className="text-muted-foreground text-[10px] max-sm:text-xs font-medium uppercase tracking-wide">
            {kpi.label}
          </span>
          <span className="mt-1 truncate text-lg font-semibold tabular-nums leading-tight">
            {kpi.value}
          </span>
        </div>
      ))}
    </div>
  )
}
