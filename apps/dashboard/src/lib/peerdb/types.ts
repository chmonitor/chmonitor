/**
 * PeerDB API response shapes (the subset CHM consumes, view-only).
 *
 * Sourced from PeerDB `protos/route.proto` (`FlowService`), exposed as REST via
 * grpc-gateway at `${PEERDB_API_URL}/v1/*`. grpc-gateway renders proto enums as
 * their string names (e.g. "STATUS_RUNNING", "POSTGRES"), but the underlying
 * catalog stores some as integers — so fields that may be either are typed
 * `string | number` and normalized at the edges (see `peer-type-icon`,
 * `mirror-status-badge`). Fields are intentionally optional/defensive because
 * the exact JSON casing varies across PeerDB versions.
 */

/** Browser-safe PeerDB connection status (from `/api/v1/peerdb-status`). */
export interface PeerDBStatusPayload {
  configured: boolean
  /** Sanitized host as `hostname:port` (no scheme/credentials/path), or null. */
  host: string | null
  state: 'connected' | 'auth' | 'unreachable' | 'not-configured'
  version?: string
  error?: string
}

/** PeerDB FlowStatus lifecycle (proto `FlowStatus`). */
export type FlowStatus =
  | 'STATUS_SETUP'
  | 'STATUS_SNAPSHOT'
  | 'STATUS_RUNNING'
  | 'STATUS_PAUSING'
  | 'STATUS_PAUSED'
  | 'STATUS_FAILED'
  | 'STATUS_TERMINATING'
  | 'STATUS_TERMINATED'
  | 'STATUS_UNKNOWN'
  | (string & {})

/** A peer database type (proto `DBType`), name or numeric ordinal. */
export type DBType = string | number

/** One row of `GET /v1/mirrors/list`. */
export interface MirrorListItem {
  id?: string | number
  workflowId?: string
  name: string
  sourceName?: string
  sourceType?: DBType
  destinationName?: string
  destinationType?: DBType
  createdAt?: string | number
  isCdc?: boolean
  status?: FlowStatus
}

export interface ListMirrorsResponse {
  mirrors?: MirrorListItem[]
}

/** One point of `POST /v1/mirrors/cdc/graph`. */
export interface GraphPoint {
  time?: string
  rows?: number
}

export interface GraphResponse {
  data?: GraphPoint[]
  totalRows?: number
}

/** Per-table aggregate counts (`GET /v1/mirrors/cdc/table_total_counts/{flow}`). */
export interface CDCTableRowCounts {
  tableName?: string
  counts?: {
    totalCount?: number
    insertsCount?: number
    updatesCount?: number
    deletesCount?: number
  }
}

export interface CDCTableTotalCountsResponse {
  totalData?: CDCTableRowCounts['counts']
  tablesData?: CDCTableRowCounts[]
}

/** One CDC batch (`POST /v1/mirrors/cdc/batches`). */
export interface CDCBatch {
  batchId?: string | number
  startLsn?: string | number
  endLsn?: string | number
  numRows?: number
  startTime?: string
  endTime?: string
}

export interface GetCDCBatchesResponse {
  cdcBatches?: CDCBatch[]
  total?: number
  page?: number
}

/** One QRep / initial-load partition (proto `PartitionStatus`). */
export interface QRepPartition {
  partitionId?: string
  startTime?: string
  endTime?: string
  pullEndTime?: string
  numRows?: number
  rowsInPartition?: number
  rowsSynced?: number
  restartCount?: number
}

export interface QRepMirrorStatus {
  config?: Record<string, unknown>
  partitions?: QRepPartition[]
}

/** Per-table clone summary during snapshot/initial-load (proto `CloneTableSummary`). */
export interface CloneTableSummary {
  tableName?: string
  sourceTable?: string
  startTime?: string
  numPartitionsCompleted?: number
  numPartitionsTotal?: number
  numRowsSynced?: number
  avgTimePerPartitionMs?: number | string
  fetchCompleted?: boolean
  consolidateCompleted?: boolean
}

/**
 * `GET /v1/mirrors/cdc/initial_load/{flow}` — per-table clone summaries for the
 * snapshot / initial-load phase (proto `InitialLoadSummaryResponse`).
 */
export interface InitialLoadSummaryResponse {
  tableSummaries?: CloneTableSummary[]
}

/**
 * `GET /v1/mirrors/total_rows_synced/{flow}` — authoritative cumulative rows
 * synced for a mirror. Field name varies across PeerDB versions, so accept the
 * known aliases and normalize at the edge (see `mirror` detail page).
 */
export interface TotalRowsSyncedResponse {
  totalCount?: number | string
  totalRowsSynced?: number | string
}

export interface CDCMirrorStatus {
  config?: Record<string, unknown>
  snapshotStatus?: { clones?: CloneTableSummary[] }
  cdcBatches?: CDCBatch[]
  sourceType?: DBType
  destinationType?: DBType
  rowsSynced?: number | string
}

/** `POST /v1/mirrors/status`. */
export interface MirrorStatusResponse {
  flowJobName?: string
  currentFlowState?: FlowStatus
  createdAt?: string
  cdcStatus?: CDCMirrorStatus
  qrepStatus?: QRepMirrorStatus
  errorMessage?: string
  lagSec?: number | null
}

/** One mirror error/log entry (`POST /v1/mirrors/logs`). */
export interface MirrorLog {
  id?: string | number
  flowName?: string
  errorMessage?: string
  errorType?: string
  errorTimestamp?: string | number
}

export interface ListMirrorLogsResponse {
  errors?: MirrorLog[]
  total?: number
  page?: number
}

/** One peer (`GET /v1/peers/list`). */
export interface PeerListItem {
  name: string
  type?: DBType
}

export interface ListPeersResponse {
  items?: PeerListItem[]
  sourceItems?: PeerListItem[]
  destinationItems?: PeerListItem[]
}

/** Replication slot info (`GET /v1/peers/slots/{peer}`). */
export interface SlotInfo {
  slotName?: string
  redoLSN?: string
  restartLSN?: string
  confirmedFlushLSN?: string
  active?: boolean
  lagInMb?: number
  walStatus?: string
}

export interface PeerSlotResponse {
  slotData?: SlotInfo[]
}

/** One slot-lag history point (`POST /v1/peers/slots/lag_history`). */
export interface SlotLagPoint {
  time?: string
  size?: number
  redoLSN?: string
  restartLSN?: string
  confirmedLSN?: string
}

export interface SlotLagHistoryResponse {
  data?: SlotLagPoint[]
}

/** `GET /v1/peers/info/{peer}` — peer config (secrets redacted) + version. */
export interface PeerInfoResponse {
  peer?: {
    name?: string
    type?: DBType
    /** One of the <kind>Config blocks; field names vary by peer type. */
    config?: Record<string, unknown>
    [key: string]: unknown
  }
  version?: string
}

/** Active query on a peer (`GET /v1/peers/stats/{peer}`). */
export interface PeerStatInfo {
  pid?: number
  waitEvent?: string
  waitEventType?: string
  queryStart?: string
  query?: string
  duration?: number | string
  state?: string
}

export interface PeerStatResponse {
  statData?: PeerStatInfo[]
}
