import { useVirtualizer } from '@tanstack/react-virtual'

import { type RefObject, useRef } from 'react'

const DEFAULT_VIRTUALIZE_THRESHOLD = 250

export interface UseVirtualRowsOptions {
  /** Estimated row height in pixels (default: 40) */
  estimateSize?: number
  /** Number of rows to render outside viewport (default: 20) */
  overscan?: number
  /** Row count threshold to enable virtualization (default: 250) */
  virtualizeThreshold?: number
  /**
   * Hard disable virtualization regardless of row count. Used when a feature
   * incompatible with the current fixed-height virtualizer is on — namely
   * inline row expansion, which adds out-of-band height to each row.
   */
  disabled?: boolean
}

export interface UseVirtualRowsResult {
  /** The virtualizer instance from @tanstack/react-virtual */
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>> | null
  /** Ref to attach to the scroll container element */
  tableContainerRef: RefObject<HTMLDivElement | null>
  /** Whether virtualization is enabled */
  isVirtualized: boolean
}

export function useVirtualRows(
  rowCount: number,
  options: UseVirtualRowsOptions = {}
): UseVirtualRowsResult {
  const {
    estimateSize = 40,
    overscan = 20,
    virtualizeThreshold = DEFAULT_VIRTUALIZE_THRESHOLD,
    disabled = false,
  } = options

  const tableContainerRef = useRef<HTMLDivElement>(null)
  const shouldVirtualize = !disabled && rowCount >= virtualizeThreshold

  const virtualizer = useVirtualizer<HTMLDivElement, Element>({
    count: rowCount,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => estimateSize,
    overscan,
    enabled: shouldVirtualize,
  })

  return {
    virtualizer: shouldVirtualize ? virtualizer : null,
    tableContainerRef,
    isVirtualized: shouldVirtualize,
  }
}
