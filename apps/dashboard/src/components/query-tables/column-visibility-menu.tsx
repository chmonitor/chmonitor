import { SlidersHorizontal } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ColumnVisibilityMenuProps<TKey extends string> {
  columns: readonly { key: TKey; label: string }[]
  hiddenColumns: Set<TKey>
  onToggle: (key: TKey) => void
}

/**
 * Column-visibility dropdown shared by the query tables — a checkbox per
 * optional column, checked when the column is visible. Base UI's
 * `MenuCheckboxItem` already defaults `closeOnClick` to `false`, so the menu
 * stays open while toggling several columns without extra wiring.
 */
export function ColumnVisibilityMenu<TKey extends string>({
  columns,
  hiddenColumns,
  onToggle,
}: ColumnVisibilityMenuProps<TKey>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Column settings"
            className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          />
        }
      >
        <SlidersHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {columns.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.key}
            checked={!hiddenColumns.has(col.key)}
            onCheckedChange={() => onToggle(col.key)}
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
