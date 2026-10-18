import type { PartLogRow } from './lib'

import { lifecycleClass, num, SIZE_BINS, TONE_COLOR, tableTone } from './lib'

export interface PartLogKpis {
  totalEvents: number
  tableCount: number
  newParts: number
  newAvgSize: number
  merges: number
  mergeRegularPct: number
  mergeTtlPct: number
  reclaimedBytes: number
  removedParts: number
}

export function derivePartLogData(rows: PartLogRow[]) {
  const tables = new Set<string>()
  let newParts = 0
  let newSizeSum = 0
  let merges = 0
  let mergeRegular = 0
  let mergeTtl = 0
  let removedParts = 0
  let reclaimedBytes = 0

  const reasonCounts: Record<string, number> = {
    RegularMerge: 0,
    TTLDeleteMerge: 0,
    TTLRecompressMerge: 0,
    NotAMerge: 0,
  }
  const churn = new Map<string, number>()
  const sizeBins = new Array(SIZE_BINS.length).fill(0)
  const sizesBelow64k: number[] = []
  const allSizes: number[] = []

  for (const r of rows) {
    tables.add(r.table)
    const cls = lifecycleClass(r.event_type)
    const size = num(r.size_in_bytes)
    churn.set(r.table, (churn.get(r.table) ?? 0) + 1)

    if (cls === 'new') {
      newParts++
      newSizeSum += size
    }
    if (cls === 'merge') {
      merges++
      if (r.merge_reason === 'RegularMerge') mergeRegular++
      else if (r.merge_reason.startsWith('TTL')) mergeTtl++
    }
    if (cls === 'remove') {
      removedParts++
      reclaimedBytes += size
    }

    if (r.merge_reason in reasonCounts) reasonCounts[r.merge_reason]++

    // size distribution: only count parts that physically exist (have bytes)
    if (size > 0) {
      const binIdx = SIZE_BINS.findIndex((b) => size < b.max)
      sizeBins[binIdx === -1 ? SIZE_BINS.length - 1 : binIdx]++
      allSizes.push(size)
      if (size < 64 * 1024) sizesBelow64k.push(size)
    }
  }

  const kpis: PartLogKpis = {
    totalEvents: rows.length,
    tableCount: tables.size,
    newParts,
    newAvgSize: newParts ? newSizeSum / newParts : 0,
    merges,
    mergeRegularPct: merges ? Math.round((mergeRegular / merges) * 100) : 0,
    mergeTtlPct: merges ? Math.round((mergeTtl / merges) * 100) : 0,
    reclaimedBytes,
    removedParts,
  }

  const churnRows = Array.from(churn.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([table, events]) => ({
      table,
      events,
      color: TONE_COLOR[tableTone(table)],
    }))

  const sortedSizes = [...allSizes].sort((a, b) => a - b)
  const median = sortedSizes.length
    ? sortedSizes[Math.floor(sortedSizes.length / 2)]
    : 0
  const pctBelow64 = allSizes.length
    ? Math.round((sizesBelow64k.length / allSizes.length) * 100)
    : 0

  return {
    kpis,
    reasonCounts,
    churnRows,
    sizeBins,
    sizeMedian: median,
    sizePctBelow64: pctBelow64,
  }
}
