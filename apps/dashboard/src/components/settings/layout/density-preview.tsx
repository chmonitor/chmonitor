import type { TableDensity } from '@/lib/types/user-settings'
import type { SegmentedOption } from '../segmented-control'

import { cn } from '@/lib/utils'

export const densityOptions: readonly SegmentedOption<TableDensity>[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]

/**
 * Mini illustration of table row density — taller, looser rows for
 * "comfortable", tighter rows for "compact".
 */
export function DensityPreview({ density }: { density: TableDensity }) {
  const isCompact = density === 'compact'
  return (
    <div
      className={cn(
        'flex w-full flex-col rounded-md border border-border bg-muted/30 p-2',
        isCompact ? 'gap-1' : 'gap-2.5'
      )}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={cn(
            'rounded bg-foreground/10',
            isCompact ? 'h-2' : 'h-3.5'
          )}
        />
      ))}
    </div>
  )
}
