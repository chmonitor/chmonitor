import type { Column, Row } from '@tanstack/react-table'

import { useRef } from 'react'

interface AutoFitResult {
  columnId: string
  fittedWidth: number
}

interface AutoFitOptions {
  /** Minimum column width in pixels (default: 50) */
  minWidth?: number
  /** Maximum column width in pixels (default: 500) */
  maxWidth?: number
  /** Padding to add to fitted width (default: 16) */
  padding?: number
  /** Header text included in calculation (default: true) */
  includeHeader?: boolean
  /** Max rows to sample for performance (default: 100) */
  maxSampleRows?: number
}

const DEFAULT_OPTIONS: Required<AutoFitOptions> = {
  minWidth: 40,
  maxWidth: 500,
  padding: 16,
  includeHeader: true,
  maxSampleRows: 100,
}

export function useAutoFitColumns<TData>(
  _tableRef: React.RefObject<HTMLDivElement | null>,
  options: AutoFitOptions = {}
) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const measureCache = useRef<Map<string, number>>(new Map())

  const measureTextWidth = (text: string): number => {
    const cacheKey = text
    if (measureCache.current.has(cacheKey)) {
      return measureCache.current.get(cacheKey)!
    }

    const measureEl = document.createElement('div')
    measureEl.style.position = 'absolute'
    measureEl.style.visibility = 'hidden'
    measureEl.style.height = '0'
    measureEl.style.overflow = 'hidden'
    measureEl.style.whiteSpace = 'nowrap'
    measureEl.style.padding = '16px' // Matches px-4 in table cells
    measureEl.style.fontSize = '12px' // Match table font size
    measureEl.style.fontWeight = 'normal'
    measureEl.textContent = text

    document.body.appendChild(measureEl)
    const width = measureEl.offsetWidth
    document.body.removeChild(measureEl)

    measureCache.current.set(cacheKey, width)
    return width
  }

  const autoFitColumn = (
    column: Column<TData, unknown>,
    rows: Row<TData>[],
    headerText?: string
  ): AutoFitResult => {
    let maxContentWidth =
      headerText && opts.includeHeader ? measureTextWidth(headerText) : 0

    const sampleSize = Math.min(rows.length, opts.maxSampleRows)
    const step =
      rows.length > sampleSize ? Math.floor(rows.length / sampleSize) : 1

    for (let i = 0; i < rows.length; i += step) {
      const row = rows[i]
      const cellValue = row.getValue(column.id)

      if (cellValue != null) {
        const text = String(cellValue)
        const cellWidth = measureTextWidth(text)
        maxContentWidth = Math.max(maxContentWidth, cellWidth)
      }
    }

    const fittedWidth = Math.min(
      opts.maxWidth,
      Math.max(opts.minWidth, maxContentWidth + opts.padding)
    )

    column.resetSize() // First reset to clear any manual sizing
    column.columnDef.size = fittedWidth

    return {
      columnId: column.id,
      fittedWidth,
    }
  }

  const autoFitAllColumns = (
    columns: Column<TData, unknown>[],
    rows: Row<TData>[]
  ): AutoFitResult[] => {
    return columns.map((column) => {
      const headerText = column.columnDef.header as string
      return autoFitColumn(column, rows, headerText)
    })
  }

  const clearCache = () => {
    measureCache.current.clear()
  }

  return {
    autoFitColumn,
    autoFitAllColumns,
    clearCache,
  }
}
