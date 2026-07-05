import { Download } from 'lucide-react'
import { toast } from 'sonner'
import type { RowData, Table } from '@tanstack/react-table'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { downloadCsv, valueToCsv } from '@/lib/csv'

interface CsvExportButtonProps<TData extends RowData = RowData> {
  table: Table<TData>
  /** Optional filename for the download (without extension) */
  filename?: string
}

/**
 * Generate CSV content from table rows and columns
 */
function generateCsvContent<TData extends RowData>(
  table: Table<TData>
): string | null {
  const columns = table.getAllLeafColumns()
  const rows = table.getRowModel().rows

  if (rows.length === 0) {
    return null
  }

  // Generate header row
  const headers = columns.map((col) => valueToCsv(col.id))
  const csvRows = [headers.join(',')]

  // Generate data rows
  for (const row of rows) {
    const values = columns.map((col) => {
      const value = row.getValue(col.id)
      return valueToCsv(value)
    })
    csvRows.push(values.join(','))
  }

  return csvRows.join('\n')
}

/**
 * CSV Export Button - Export table data to CSV file
 *
 * Provides options to export:
 * - Current page only
 * - All data (if client-side filtered/paginated)
 *
 * Features:
 * - Handles null/undefined values
 * - Properly escapes values with commas, quotes, or newlines
 * - Generates filename with timestamp
 * - Shows toast notifications
 */
export const CsvExportButton = function CsvExportButton<
  TData extends RowData = RowData,
>({ table, filename = 'export' }: CsvExportButtonProps<TData>) {
  const handleExportCurrentPage = () => {
    const csvContent = generateCsvContent(table)

    if (!csvContent) {
      toast.error('No data to export')
      return
    }

    const timestamp = new Date().toISOString().slice(0, 10)
    downloadCsv(csvContent, `${filename}-${timestamp}`)

    toast.success('Exported current page to CSV')
  }

  const handleExportAllData = () => {
    // Get all rows (not just current page) - this works for client-side data
    const allRows = table.getCoreRowModel().rows

    if (allRows.length === 0) {
      toast.error('No data to export')
      return
    }

    const columns = table.getAllLeafColumns()

    // Generate header row
    const headers = columns.map((col) => valueToCsv(col.id))
    const csvRows = [headers.join(',')]

    // Generate data rows from all data
    for (const row of allRows) {
      const values = columns.map((col) => {
        const value = row.getValue(col.id)
        return valueToCsv(value)
      })
      csvRows.push(values.join(','))
    }

    const csvContent = csvRows.join('\n')
    const timestamp = new Date().toISOString().slice(0, 10)
    downloadCsv(csvContent, `${filename}-all-${timestamp}`)

    toast.success(`Exported ${allRows.length} rows to CSV`)
  }

  const hasData = table.getRowModel().rows.length > 0

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 opacity-40 hover:opacity-100 transition-opacity rounded-full"
            aria-label="Export to CSV"
            title="Export to CSV"
            disabled={!hasData}
          />
        }
      >
        <Download className="size-3 sm:size-3" strokeWidth={2} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={handleExportCurrentPage}
          className="gap-2 cursor-pointer"
          disabled={!hasData}
        >
          <Download
            className="size-3.5 text-muted-foreground"
            strokeWidth={1.5}
          />
          <span>Current Page</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleExportAllData}
          className="gap-2 cursor-pointer"
          disabled={!hasData}
        >
          <Download
            className="size-3.5 text-muted-foreground"
            strokeWidth={1.5}
          />
          <span>All Data</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
