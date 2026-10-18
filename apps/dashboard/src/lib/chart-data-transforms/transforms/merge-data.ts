import type {
  SummaryDataTransformed,
  SummaryInputData,
  SummaryMetricsItem,
} from '../types'

export function transformMergeSummaryData(
  data: SummaryInputData
): SummaryDataTransformed | null {
  const used = data.used?.[0]
  const totalMem = data.totalMem?.[0]
  const rowsReadWritten = data.rowsReadWritten?.[0]
  const bytesReadWritten = data.bytesReadWritten?.[0]

  if (!used || !totalMem || !rowsReadWritten) {
    return null
  }

  const items: SummaryMetricsItem[] = []

  if (rowsReadWritten.rows_read < rowsReadWritten.rows_written) {
    items.push({
      current: rowsReadWritten.rows_read,
      target: rowsReadWritten.rows_written,
      currentReadable: `${rowsReadWritten.readable_rows_read} rows read`,
      targetReadable: `${rowsReadWritten.readable_rows_written} rows written`,
    })
  } else {
    items.push({
      current: rowsReadWritten.rows_written,
      target: rowsReadWritten.rows_read,
      currentReadable: `${rowsReadWritten.readable_rows_written} rows written`,
      targetReadable: `${rowsReadWritten.readable_rows_read} rows read`,
    })
  }

  if (bytesReadWritten) {
    if (bytesReadWritten.bytes_read < bytesReadWritten.bytes_written) {
      items.push({
        current: bytesReadWritten.bytes_read,
        target: bytesReadWritten.bytes_written,
        currentReadable: `${bytesReadWritten.readable_bytes_read} read (uncompressed)`,
        targetReadable: `${bytesReadWritten.readable_bytes_written} written (uncompressed)`,
      })
    } else {
      items.push({
        current: bytesReadWritten.bytes_written,
        target: bytesReadWritten.bytes_read,
        currentReadable: `${bytesReadWritten.readable_bytes_written} written (uncompressed)`,
        targetReadable: `${bytesReadWritten.readable_bytes_read} read (uncompressed)`,
      })
    }
  }

  items.push({
    current: used.memory_usage,
    target: totalMem.total,
    currentReadable: `${used.readable_memory_usage} memory used`,
    targetReadable: `${totalMem.readable_total} total`,
  })

  return {
    primary: {
      memoryUsage: used.readable_memory_usage,
      description: 'memory used for merges',
    },
    items,
    raw: {
      used,
      totalMem,
      rowsReadWritten,
      bytesReadWritten,
    },
  }
}
