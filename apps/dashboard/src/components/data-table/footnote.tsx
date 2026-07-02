import type { RowData, Table } from '@tanstack/react-table'

export interface FootnoteProps<TData extends RowData = RowData> {
  table: Table<TData>
  footnote?: string | React.ReactNode
}

export const Footnote = function Footnote<TData extends RowData = RowData>({
  table,
  footnote,
}: FootnoteProps<TData>) {
  return (
    <div className="min-w-0 flex-1 text-wrap break-words text-sm text-muted-foreground">
      {footnote ? (
        footnote
      ) : (
        <>
          {table.getFilteredSelectedRowModel().rows.length} of{' '}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </>
      )}
    </div>
  )
}
