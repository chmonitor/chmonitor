import type {
  CDCBatch,
  GetCDCBatchesResponse,
  GraphResponse,
  MirrorStatusResponse,
  QRepPartition,
} from '@/lib/peerdb/types'

import { parseTs, toNumber } from './peerdb-utils'
import { usePeerDB } from '@/lib/swr'

export interface DerivedMetrics {
  trend: number[]
  rowsPerSec: number
  rowsSynced: number
  lagSec: number | null
  partitions: QRepPartition[]
  batches: CDCBatch[]
  errorMessage?: string
  loading: boolean
}

/** Summary surfaced to the page so it can aggregate KPI totals + lag triage. */
export interface MirrorMetricsSummary {
  rowsPerSec: number
  rowsSynced: number
  trend: number[]
  lagSec: number | null
}

/**
 * Fetch per-mirror status + throughput; shared (SWR-deduped) with the row.
 * `enabled` gates the network calls so large mirror lists don't fan out to the
 * PeerDB API for every collapsed row — metrics load lazily on expand.
 */
export function useMirrorMetrics(
  name: string,
  isCdc: boolean,
  enabled: boolean
): DerivedMetrics {
  const status = usePeerDB<MirrorStatusResponse>(
    enabled ? '/mirrors/status' : null,
    {
      body: { flowJobName: name, includeFlowInfo: true },
      refreshInterval: 60_000,
    }
  )
  const graph = usePeerDB<GraphResponse>(
    enabled ? '/mirrors/cdc/graph' : null,
    {
      body: { flowJobName: name, aggregateType: '1min' },
      refreshInterval: 60_000,
    }
  )
  // Batches fetched explicitly — real PeerDB does not embed them in status,
  // so the lag number/chart would otherwise be empty against the live API.
  const batchesReq = usePeerDB<GetCDCBatchesResponse>(
    enabled && isCdc ? '/mirrors/cdc/batches' : null,
    {
      body: { flowJobName: name, page: 0, numPerPage: 24 },
      refreshInterval: 60_000,
    }
  )

  const cdc = status.data?.cdcStatus
  const qrep = status.data?.qrepStatus
  const partitions = qrep?.partitions ?? []
  const batches = batchesReq.data?.cdcBatches ?? cdc?.cdcBatches ?? []
  const trend = (graph.data?.data ?? []).map((p) => toNumber(p.rows))

  // Use the second-to-last bucket when available (complete 1-min window);
  // the latest bucket may be partial and understate throughput.
  const _bucketIdx = trend.length > 1 ? trend.length - 2 : trend.length - 1
  const rowsPerSec = trend.length ? trend[_bucketIdx] / 60 : 0

  const rowsSynced = isCdc
    ? cdc?.rowsSynced == null
      ? toNumber(graph.data?.totalRows)
      : toNumber(cdc.rowsSynced)
    : partitions.reduce((a, p) => a + toNumber(p.rowsSynced), 0)

  let lagSec: number | null = status.data?.lagSec ?? null
  if (lagSec === null && isCdc && batches.length) {
    const last = batches[batches.length - 1]
    const end = last.endTime ? parseTs(last.endTime) : null
    if (end != null) lagSec = Math.max(0, (Date.now() - end) / 1000)
  }

  return {
    trend,
    rowsPerSec,
    rowsSynced,
    lagSec,
    partitions,
    batches,
    errorMessage: status.data?.errorMessage,
    loading: status.isLoading || graph.isLoading,
  }
}
