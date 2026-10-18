export type UserEventCountItem = {
  event_time: string
  user: string
  count: number
}

export type UserEventCountsTransformed<T extends string = string> = {
  data: Record<T, Record<string, number>>
  users: string[]
  chartData: Array<Record<T, string> & Record<string, number>>
}

export type MemoryUsageData = {
  memory_usage: number
  readable_memory_usage: string
}

export type TotalMemData = {
  metric: string
  total: number
  readable_total: string
}

export type RowsReadWrittenData = {
  rows_read: number
  rows_written: number
  readable_rows_read: string
  readable_rows_written: string
}

export type BytesReadWrittenData = {
  bytes_read: number
  bytes_written: number
  readable_bytes_read: string
  readable_bytes_written: string
}

export type QueryCountData = {
  query_count: number
}

export type SummaryMetricsItem = {
  current: number
  target: number
  currentReadable: string
  targetReadable: string
}

export type SummaryInputData = {
  used?: MemoryUsageData[]
  totalMem?: TotalMemData[]
  rowsReadWritten?: RowsReadWrittenData[]
  bytesReadWritten?: BytesReadWrittenData[]
  todayQueryCount?: QueryCountData[]
  main?: (MemoryUsageData & QueryCountData)[]
}

export type SummaryDataTransformed = {
  primary: {
    memoryUsage: string
    description: string
  }
  items: SummaryMetricsItem[]
  raw: {
    used: MemoryUsageData & Partial<QueryCountData>
    totalMem: TotalMemData
    rowsReadWritten: RowsReadWrittenData
    bytesReadWritten?: BytesReadWrittenData
    todayQueryCount?: number
  }
}

export type ReadWritePair = {
  value: number
  readable: string
}
