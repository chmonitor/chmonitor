import type { MirrorLog, RawMirrorLog } from './types'

/**
 * Shared PeerDB mirror-log normalization contract
 * (`POST /v1/mirrors/logs`).
 *
 * One place owns every wire quirk so the mirror detail page, the fleet
 * logs feed, and the alert lane all count errors identically:
 *
 * - Strict PeerDB matches the `level` request param case-sensitively
 *   (`ALL` / `INFO` / `WARN` / `ERROR`); lowercase values return zero rows.
 *   Build request bodies with {@link mirrorLogsRequestBody}, never by hand.
 * - Log entries may arrive camelCase (grpc-gateway) or snake_case (UI mode);
 *   normalize every entry with {@link normalizeMirrorLog}.
 * - The log array may sit under `errors`, `logs`, or `data` (or be a bare
 *   array); unwrap every payload with {@link extractMirrorLogs}.
 * - Missing/unknown level classifiers stay `info` — info and untyped entries
 *   are never counted as errors (see {@link countMirrorLogLevels}).
 */

export type MirrorLogLevel = 'error' | 'warn' | 'info'

export type MirrorLogLevelFilter = MirrorLogLevel | 'all'

/** Upstream wire values for the `level` field of `POST /v1/mirrors/logs`. */
const LEVEL_PARAM: Record<MirrorLogLevel, 'ERROR' | 'WARN' | 'INFO'> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
}

/**
 * Map a UI level filter to the upstream `level` request value. `all` (and
 * unknown values) map to `undefined` so the field is omitted and PeerDB
 * returns every level — never send a value the API does not recognize.
 */
export function toMirrorLogsLevelParam(
  level: MirrorLogLevelFilter | string | undefined
): 'ERROR' | 'WARN' | 'INFO' | undefined {
  if (level === 'error' || level === 'warn' || level === 'info')
    return LEVEL_PARAM[level]
  return undefined
}

/**
 * Request body for `POST /v1/mirrors/logs`. Emits the uppercase `level`
 * strict PeerDB requires; omits `level` for `all` (PeerDB defaults to ALL).
 */
export function mirrorLogsRequestBody(
  flowJobName: string,
  level: MirrorLogLevelFilter = 'all',
  opts?: { page?: number; numPerPage?: number }
): Record<string, unknown> {
  const param = toMirrorLogsLevelParam(level)
  return {
    flowJobName,
    ...(param ? { level: param } : {}),
    page: opts?.page ?? 0,
    numPerPage: opts?.numPerPage ?? 100,
  }
}

/**
 * Classify a raw log level value to a canonical tab. Case-insensitive and
 * tolerant of the `warning` synonym; missing/unknown values are `info` so
 * unrelated logs are never counted as errors.
 */
export function normalizeLogLevel(value: unknown): MirrorLogLevel {
  const t = String(value ?? 'info').toLowerCase()
  if (t.startsWith('err')) return 'error'
  if (t.startsWith('warn')) return 'warn'
  return 'info'
}

function pickString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

function pickTimestamp(...values: unknown[]): string | number | undefined {
  for (const v of values) {
    if (typeof v === 'string' || typeof v === 'number') return v
  }
  return undefined
}

/**
 * Normalize one raw log entry to the canonical {@link MirrorLog} shape,
 * accepting camelCase (grpc-gateway) and snake_case (UI mode) spellings plus
 * the common `level`/`message`/`timestamp` aliases.
 */
export function normalizeMirrorLog(raw: unknown): MirrorLog {
  const r = (raw ?? {}) as RawMirrorLog & Record<string, unknown>
  const id =
    typeof r.id === 'string' || typeof r.id === 'number' ? r.id : undefined
  return {
    ...(id !== undefined ? { id } : {}),
    flowName: pickString(r.flowName, r.flow_name, r.flow, r.mirrorName),
    errorMessage: pickString(r.errorMessage, r.error_message, r.message, r.msg),
    errorType: pickString(r.errorType, r.error_type, r.level, r.severity),
    errorTimestamp: pickTimestamp(
      r.errorTimestamp,
      r.error_timestamp,
      r.timestamp,
      r.time
    ),
  }
}

/**
 * Unwrap a `POST /v1/mirrors/logs` payload to normalized entries. Accepts the
 * documented `{errors}` envelope plus the `{logs}` / `{data}` aliases and
 * bare arrays seen across PeerDB versions; anything else yields `[]`.
 */
export function extractMirrorLogs(payload: unknown): MirrorLog[] {
  if (Array.isArray(payload))
    return (payload as unknown[]).map(normalizeMirrorLog)
  if (payload && typeof payload === 'object') {
    const p = payload as {
      errors?: unknown
      logs?: unknown
      data?: unknown
    }
    const list = p.errors ?? p.logs ?? p.data
    if (Array.isArray(list)) return (list as unknown[]).map(normalizeMirrorLog)
  }
  return []
}

/** Per-tab counts over normalized entries (`info` absorbs untyped rows). */
export function countMirrorLogLevels(
  logs: MirrorLog[]
): Record<MirrorLogLevelFilter, number> {
  const counts: Record<MirrorLogLevelFilter, number> = {
    all: 0,
    error: 0,
    warn: 0,
    info: 0,
  }
  for (const l of logs) {
    counts.all++
    counts[normalizeLogLevel(l.errorType)]++
  }
  return counts
}
