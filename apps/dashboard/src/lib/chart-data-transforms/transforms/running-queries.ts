import type {
  SummaryDataTransformed,
  SummaryInputData,
  SummaryMetricsItem,
} from '../types'

export function transformRunningQueriesSummaryData(
  data: SummaryInputData
): SummaryDataTransformed | null {
  const main = data.main?.[0]
  const totalMem = data.totalMem?.[0]
  const rowsReadWritten = data.rowsReadWritten?.[0]
  const todayQueryCount = data.todayQueryCount?.[0]?.query_count

  if (!main || !totalMem || !rowsReadWritten) {
    return null
  }

  const items: SummaryMetricsItem[] = []

  items.push({
    current: main.memory_usage,
    target: totalMem.total,
    currentReadable: `${main.readable_memory_usage} memory usage`,
    targetReadable: `${totalMem.readable_total} total`,
  })

  items.push({
    current: main.query_count,
    target: todayQueryCount ?? main.query_count,
    currentReadable: `${main.query_count} running queries`,
    targetReadable: `${todayQueryCount ?? main.query_count} today`,
  })

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

  return {
    primary: {
      memoryUsage: main.readable_memory_usage,
      description: 'memory used for running queries',
    },
    items,
    raw: {
      used: {
        query_count: main.query_count,
        memory_usage: main.memory_usage,
        readable_memory_usage: main.readable_memory_usage,
      },
      totalMem,
      rowsReadWritten,
      todayQueryCount,
    },
  }
}
