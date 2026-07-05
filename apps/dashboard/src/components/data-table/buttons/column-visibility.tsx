import { MixerHorizontalIcon } from '@radix-ui/react-icons'
import type { RowData, Table } from '@tanstack/react-table'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ColumnVisibilityButtonProps<TData extends RowData = RowData> {
  table: Table<TData>
}

export const ColumnVisibilityButton = function ColumnVisibilityButton<
  TData extends RowData = RowData,
>({ table }: ColumnVisibilityButtonProps<TData>) {
  const handleSelect = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    // Prevent default selection behavior to avoid
    // unintended interactions with checkbox state
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 sm:size-5 opacity-40 hover:opacity-100 transition-opacity rounded-full"
            aria-label="Column Options"
            title="Column Options"
          />
        }
      >
        <MixerHorizontalIcon className="size-3 sm:size-3" strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[60vh] overflow-y-auto">
        {table
          .getAllColumns()
          .filter((column) => column.getCanHide())
          .map((column) => {
            return (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={(value) => column.toggleVisibility(!!value)}
                onSelect={handleSelect}
                role="checkbox"
                aria-label={column.id}
              >
                {column.id}
              </DropdownMenuCheckboxItem>
            )
          })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
