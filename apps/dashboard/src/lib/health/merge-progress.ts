/** Work counters stay exact even above Number.MAX_SAFE_INTEGER. */
export const MERGE_WORK_COUNTERS = [
  'rows_read',
  'rows_written',
  'bytes_read_uncompressed',
  'bytes_written_uncompressed',
  'columns_written',
] as const

export const MERGE_PROGRESS_SQL = `SELECT database, table, result_part_name,
  elapsed, progress, rows_read, rows_written, bytes_read_uncompressed,
  bytes_written_uncompressed, columns_written
FROM system.merges`

// The scheduled sweep runs every 10 minutes (wrangler.toml). Allow scheduling
// jitter, but not a missed tick. Self-hosted schedulers must sample at least
// every 10 minutes too; a larger gap starts a new observation window.
export const MERGE_MAX_SAMPLE_GAP_MS = 600_000 * 1.5
const START_TOLERANCE_MS = 5_000

export interface MergeObservation {
  identity: string
  name: string
  elapsed: number
  progress: number
  counters: string[]
}

export interface MergeProgressSample extends MergeObservation {
  observedAtMs: number
  startedAtMs: number
  /** Latest possible start, bounded by request completion rather than latency guesses. */
  startedLatestMs: number
  /** At least one work advance in this continuous window can prove recovery. */
  confirmedWork: boolean
  flatSinceMs: number
}

export interface MergeProgressSnapshot {
  version: number
  updatedAtMs: number
  samples: MergeProgressSample[]
}

function nonnegative(raw: unknown): number | null {
  if ((typeof raw !== 'number' && typeof raw !== 'string') || raw === '')
    return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function counter(raw: unknown): string | null {
  if (typeof raw === 'number')
    return Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : null
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  return BigInt(raw).toString()
}

/** A partial/malformed query cannot establish absence or prune any samples. */
export function parseMergeObservations(
  rows: unknown
): MergeObservation[] | null {
  if (!Array.isArray(rows)) return null
  const out: MergeObservation[] = []
  const seen = new Set<string>()
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    if (
      ![r.database, r.table, r.result_part_name].every(
        (v) => typeof v === 'string' && v.length > 0
      )
    )
      return null
    const elapsed = nonnegative(r.elapsed)
    const progress = nonnegative(r.progress)
    const counters = MERGE_WORK_COUNTERS.map((key) => counter(r[key]))
    if (
      elapsed === null ||
      progress === null ||
      counters.some((c) => c === null)
    )
      return null
    const identity = JSON.stringify([r.database, r.table, r.result_part_name])
    if (seen.has(identity)) return null
    seen.add(identity)
    out.push({
      identity,
      name: `${r.database}.${r.table} ${r.result_part_name}`,
      elapsed,
      progress,
      counters: counters as string[],
    })
  }
  return out
}

export function mergeStallSeconds(
  raw = process.env.HEALTH_MERGE_STALL_SECONDS
): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 900
}

/** First samples, restarts and missing observations are unknown, not healthy. */
export function stepMergeProgress(
  prev: MergeProgressSample | undefined,
  current: MergeObservation,
  now: number,
  observedEndMs = now
): { next: MergeProgressSample; flatSeconds: number | null } {
  const fresh = {
    ...current,
    observedAtMs: observedEndMs,
    startedAtMs: now - current.elapsed * 1000,
    startedLatestMs: observedEndMs - current.elapsed * 1000,
    confirmedWork: false,
    flatSinceMs: observedEndMs,
  }
  if (!prev) return { next: fresh, flatSeconds: null }
  const gap = now - prev.observedAtMs
  if (
    gap <= 0 ||
    gap > MERGE_MAX_SAMPLE_GAP_MS ||
    current.elapsed < prev.elapsed ||
    fresh.startedAtMs > prev.startedLatestMs + START_TOLERANCE_MS ||
    fresh.startedLatestMs < prev.startedAtMs - START_TOLERANCE_MS ||
    current.counters.some((c, i) => BigInt(c) < BigInt(prev.counters[i]))
  ) {
    return { next: fresh, flatSeconds: null }
  }
  if (
    current.progress !== prev.progress ||
    current.counters.some((c, i) => c !== prev.counters[i])
  ) {
    return { next: { ...fresh, confirmedWork: true }, flatSeconds: 0 }
  }
  return {
    next: {
      ...fresh,
      // Retain the intersection of request-bounded start estimates. Variable
      // ClickHouse latency then cannot look like a same-part restart.
      startedAtMs: Math.max(
        fresh.startedAtMs,
        prev.startedAtMs - START_TOLERANCE_MS
      ),
      startedLatestMs: Math.min(
        fresh.startedLatestMs,
        prev.startedLatestMs + START_TOLERANCE_MS
      ),
      flatSinceMs: prev.flatSinceMs,
      confirmedWork: prev.confirmedWork,
    },
    flatSeconds: (now - prev.flatSinceMs) / 1000,
  }
}

export function computeMergeProgress(
  observations: readonly MergeObservation[],
  snapshot: MergeProgressSnapshot,
  now: number,
  stallSeconds: number,
  observedEndMs = now
): { next: MergeProgressSnapshot; value: number | null; affected: string[] } {
  const previous = new Map(snapshot.samples.map((s) => [s.identity, s]))
  const samples: MergeProgressSample[] = []
  const affected: string[] = []
  let unknown = false
  for (const observation of observations) {
    const step = stepMergeProgress(
      previous.get(observation.identity),
      observation,
      now,
      observedEndMs
    )
    samples.push(step.next)
    if (
      step.flatSeconds === null ||
      (step.flatSeconds < stallSeconds && !step.next.confirmedWork)
    )
      unknown = true
    else if (step.flatSeconds >= stallSeconds) affected.push(observation.name)
  }
  return {
    next: {
      version: snapshot.version + 1,
      updatedAtMs: observedEndMs,
      samples,
    },
    value: affected.length > 0 ? affected.length : unknown ? null : 0,
    affected: affected.slice(0, 5),
  }
}
