import { Check, Copy, Database, Info, MoreHorizontal } from 'lucide-react'

import type { ApiResponseMetadata } from '@/lib/api/types'
import type { ChartDataPoint } from '@/types/chart-data'

import { useState } from 'react'
import { ChartCsvExportButton } from '@/components/cards/chart-csv-export-button'
import { RequestInfoContent } from '@/components/dialogs/dialog-sql'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * Metadata type for CardToolbar - uses shared ApiResponseMetadata
 * with optional fields for flexibility
 */
export type CardToolbarMetadata = Partial<ApiResponseMetadata>

export interface CardToolbarProps {
  sql?: string
  data?: ChartDataPoint[] | Record<string, unknown>[]
  /** Query execution metadata */
  metadata?: CardToolbarMetadata
  /** Always show the button (not just on hover) */
  alwaysVisible?: boolean
  /** Human-readable label used to name the CSV export download */
  filename?: string
}

/**
 * CardToolbar - Dropdown menu for viewing request info and raw data
 *
 * Extracted as a standalone component for reuse in both ChartCard and ChartEmpty.
 */
export const CardToolbar = function CardToolbar({
  sql,
  data,
  metadata,
  alwaysVisible = false,
  filename,
}: CardToolbarProps) {
  const [showRequestInfo, setShowRequestInfo] = useState(false)
  const [showData, setShowData] = useState(false)
  const [copied, setCopied] = useState(false)

  const dataJson = (() => {
    return data ? JSON.stringify(data, null, 2) : null
  })()

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Check if we have metadata to show
  const hasMetadata =
    metadata &&
    (metadata.duration !== undefined ||
      metadata.rows !== undefined ||
      metadata.clickhouseVersion ||
      metadata.host ||
      metadata.queryId ||
      metadata.api)

  // Check if we have data to show
  const hasData = data && (Array.isArray(data) ? data.length > 0 : true)

  // Check if we have request info to show (metadata or SQL)
  const hasRequestInfo = hasMetadata || sql

  // Don't render if nothing to show
  if (!sql && !hasData && !hasMetadata) return null

  return (
    <>
      {hasData && (
        <ChartCsvExportButton
          data={data as ChartDataPoint[] | Record<string, unknown>[]}
          filename={filename}
          alwaysVisible={alwaysVisible}
        />
      )}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open chart actions"
              className={cn(
                'size-6 transition-opacity rounded-full',
                'relative before:content-[""] before:absolute before:-inset-4',
                alwaysVisible
                  ? 'opacity-40 hover:opacity-100'
                  : 'opacity-0 group-hover:opacity-40 hover:!opacity-100'
              )}
            />
          }
        >
          <MoreHorizontal className="size-3.5" strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[140px]">
          {hasRequestInfo && (
            <DropdownMenuItem
              onClick={() => setShowRequestInfo(true)}
              className="gap-2 text-[13px]"
            >
              <Info
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span>Request Info</span>
            </DropdownMenuItem>
          )}
          {hasData && (
            <DropdownMenuItem
              onClick={() => setShowData(true)}
              className="gap-2 text-[13px]"
            >
              <Database
                className="size-3.5 text-muted-foreground"
                strokeWidth={1.5}
              />
              <span>Raw Data</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Request Info Dialog (Metadata + SQL combined) — shares the same body
          as DialogSQL so both Request Info dialogs stay identical. */}
      <Dialog open={showRequestInfo} onOpenChange={setShowRequestInfo}>
        <DialogContent className="w-full max-w-[95vw] sm:min-w-[550px] sm:max-w-[850px] max-h-[90vh] flex flex-col p-6">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg font-medium">
              Request Info
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-auto">
            <RequestInfoContent
              sql={sql}
              metadata={metadata}
              fullScreen={false}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Data Dialog */}
      <Dialog open={showData} onOpenChange={setShowData}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <DialogTitle className="text-base font-medium">
              Raw Data
            </DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-muted-foreground"
              onClick={() => dataJson && handleCopy(dataJson)}
            >
              {copied ? (
                <Check className="size-3.5" strokeWidth={1.5} />
              ) : (
                <Copy className="size-3.5" strokeWidth={1.5} />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </DialogHeader>
          <pre className="text-[13px] leading-relaxed font-mono bg-muted/50 p-4 rounded-lg overflow-auto max-h-[60vh] border">
            {dataJson}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  )
}
