import { Download } from 'lucide-react'
import { toast } from 'sonner'

import type { ChartDataPoint } from '@/types/chart-data'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { arrayToCsv, downloadCsv, slugifyFilename } from '@/lib/csv'
import { cn } from '@/lib/utils'

interface ChartCsvExportButtonProps {
  /** Current chart data array to serialize */
  data: ChartDataPoint[] | Record<string, unknown>[]
  /** Human-readable chart label used to name the downloaded file */
  filename?: string
  /** Always show the button (not just on card hover) */
  alwaysVisible?: boolean
}

/**
 * ChartCsvExportButton - one-click CSV export for a chart card.
 *
 * Serializes the chart's current data array to CSV and triggers a download
 * named after the chart. Renders only when data is present and matches the
 * hover-reveal behavior of the other chart card toolbar icons.
 */
export const ChartCsvExportButton = function ChartCsvExportButton({
  data,
  filename,
  alwaysVisible = false,
}: ChartCsvExportButtonProps) {
  if (!data || data.length === 0) return null

  const handleExport = () => {
    const csv = arrayToCsv(data as Record<string, unknown>[])

    if (!csv) {
      toast.error('No data to export')
      return
    }

    const timestamp = new Date().toISOString().slice(0, 10)
    downloadCsv(csv, `${slugifyFilename(filename)}-${timestamp}`)
    toast.success(`Exported ${data.length} rows to CSV`)
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            onClick={handleExport}
            aria-label="Export to CSV"
            className={cn(
              'size-6 rounded-full transition-opacity',
              'relative before:content-[""] before:absolute before:-inset-4',
              alwaysVisible
                ? 'opacity-40 hover:opacity-100'
                : 'opacity-0 group-hover:opacity-40 hover:!opacity-100'
            )}
          />
        }
      >
        <Download className="size-3.5" strokeWidth={2} />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        Export to CSV
      </TooltipContent>
    </Tooltip>
  )
}
