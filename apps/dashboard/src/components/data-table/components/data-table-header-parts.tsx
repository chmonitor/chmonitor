import { LayoutGrid, Settings2Icon, Table2 } from 'lucide-react'
import type { RowData, Table } from '@tanstack/react-table'

import type { TableDensity } from '@/components/data-table/hooks'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIsMobile } from '@/hooks/use-mobile'

/** Segmented table/cards toggle. */
export function ViewToggle({
  view,
  onViewChange,
}: {
  view: 'table' | 'cards' | 'auto'
  onViewChange?: (view: 'table' | 'cards') => void
}) {
  const isMobile = useIsMobile()
  const active = view === 'auto' ? (isMobile ? 'cards' : 'table') : view
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-border/60 p-0.5"
      role="group"
      aria-label="Result view"
    >
      <Button
        type="button"
        variant={active === 'table' ? 'secondary' : 'ghost'}
        size="sm"
        className="gap-1.5 px-2 text-xs"
        aria-pressed={active === 'table'}
        onClick={() => onViewChange?.('table')}
      >
        <Table2 className="size-3.5" />
        Table
      </Button>
      <Button
        type="button"
        variant={active === 'cards' ? 'secondary' : 'ghost'}
        size="sm"
        className="gap-1.5 px-2 text-xs"
        aria-pressed={active === 'cards'}
        onClick={() => onViewChange?.('cards')}
      >
        <LayoutGrid className="size-3.5" />
        Cards
      </Button>
    </div>
  )
}

interface DisplayOptionsDropdownProps<TData extends RowData> {
  table: Table<TData>
  density: TableDensity
  onDensityChange?: (density: TableDensity) => void
  getColumnLabel: (colId: string) => string
}

/** Density radio group + column visibility checkboxes. Shared by both the
 *  schema-driven and client-side toolbar layouts. */
export function DisplayOptionsDropdown<TData extends RowData>({
  table,
  density,
  onDensityChange,
  getColumnLabel,
}: DisplayOptionsDropdownProps<TData>) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 px-3 border-border/50 rounded-lg text-xs"
            aria-label="Column Options"
            title="Column Options"
          />
        }
      >
        <Settings2Icon className="size-3.5" />
        <span>Display options</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 max-h-[80vh] overflow-y-auto rounded-xl shadow-lg"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-semibold px-2.5 py-1.5 text-muted-foreground uppercase tracking-wider">
            Density
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        {onDensityChange && (
          <DropdownMenuRadioGroup
            value={density}
            onValueChange={(v) => onDensityChange(v as TableDensity)}
            className="px-1"
          >
            <DropdownMenuRadioItem value="comfortable" className="text-xs">
              Comfortable
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="compact" className="text-xs">
              Compact
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dense" className="text-xs">
              Dense
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-semibold px-2.5 py-1.5 text-muted-foreground uppercase tracking-wider">
            Columns
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <div className="px-1">
          {table
            .getAllColumns()
            .filter((column) => column.getCanHide())
            .map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(!!value)}
                className="text-xs"
              >
                {getColumnLabel(column.id)}
              </DropdownMenuCheckboxItem>
            ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
