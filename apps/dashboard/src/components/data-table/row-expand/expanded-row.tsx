import type { Row, RowData } from '@tanstack/react-table'

import type { ExpandableConfig, ExpandedRenderer } from '@/types/query-config'

import { DefaultExpandedRow } from './default-renderer'
import { TableCell, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface ExpandedRowProps<TData extends RowData> {
  row: Row<TData>
  colSpan: number
  config: true | ExpandableConfig
}

export function ExpandedRow<TData extends RowData>({
  row,
  colSpan,
  config,
}: ExpandedRowProps<TData>) {
  const original = row.original as Record<string, unknown>
  const content =
    config === true ? (
      <DefaultExpandedRow row={original} />
    ) : (
      // ExpandableConfig is declared with a default TData of Record<string,unknown>;
      // cast the renderer locally so consumers can narrow it without re-declaring generics.
      (config.renderExpanded as ExpandedRenderer)(original, {
        row: row as unknown as Row<Record<string, unknown>>,
      })
    )

  return (
    <TableRow
      data-expanded-row
      data-row-id={row.id}
      className={cn(
        'bg-muted/40 hover:bg-muted/40',
        'border-b border-border/50'
      )}
    >
      <TableCell
        colSpan={colSpan}
        className="px-4 py-3 align-top"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="animate-in fade-in slide-in-from-top-1 duration-150">
          {content}
        </div>
      </TableCell>
    </TableRow>
  )
}
