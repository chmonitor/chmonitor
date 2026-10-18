import { Download } from 'lucide-react'
import { toast } from 'sonner'

import type { ChartDataPoint } from '@/types/chart-data'

import { chartActionClass } from '@/components/cards/chart-action-classes'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { arrayToCsv, downloadCsv, slugifyFilename } from '@/lib/csv'

interface ChartCsvExportButtonProps {
  data: ChartDataPoint[] | Record<string, unknown>[]
  filename?: string
  alwaysVisible?: boolean
}

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
            className={chartActionClass({ alwaysVisible })}
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
