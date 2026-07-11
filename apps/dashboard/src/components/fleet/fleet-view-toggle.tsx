import { LayoutGrid, Table2 } from 'lucide-react'

import type { FleetView } from './fleet-helpers'

import { Button } from '@/components/ui/button'

/** Segmented grid/table toggle for the Fleet Overview page. */
export function FleetViewToggle({
  value,
  onChange,
}: {
  value: FleetView
  onChange: (view: FleetView) => void
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5"
      role="group"
      aria-label="Fleet view"
    >
      <Button
        type="button"
        variant={value === 'grid' ? 'secondary' : 'ghost'}
        size="sm"
        className="gap-1.5 px-2 text-xs"
        aria-pressed={value === 'grid'}
        onClick={() => onChange('grid')}
      >
        <LayoutGrid className="size-3.5" />
        Grid
      </Button>
      <Button
        type="button"
        variant={value === 'table' ? 'secondary' : 'ghost'}
        size="sm"
        className="gap-1.5 px-2 text-xs"
        aria-pressed={value === 'table'}
        onClick={() => onChange('table')}
      >
        <Table2 className="size-3.5" />
        Table
      </Button>
    </div>
  )
}
