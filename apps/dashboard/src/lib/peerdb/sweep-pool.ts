/**
 * Bounded fan-out primitives for the PeerDB sweep (issue #3677).
 *
 * The alert collector used to `Promise.all` one `POST /v1/mirrors/status` AND
 * one `POST /v1/mirrors/logs` for EVERY mirror at once. On a 72-mirror fleet
 * that is 144 simultaneous catalog queries, each capped by
 * `PEERDB_FETCH_TIMEOUT_MS`: PeerDB's only index on `flow_errors` is
 * `flow_name`, so filtering by `error_type` scans every row for that mirror
 * and the whole sweep saturates the catalog Postgres — every check aborted at
 * 10s and reported errored.
 *
 * Two independent bounds live here, because a pool alone is not a fix:
 *
 *   1. {@link mapWithPool} bounds CONCURRENCY — how many upstream calls may be
 *      in flight at once. This is what actually protects the PeerDB catalog.
 *   2. {@link startSweepBudget} bounds WALL TIME — a pool of 8 over 72 mirrors
 *      at a 10s per-call timeout still needs 9 waves ≈ 90s. A budget that only
 *      caps concurrency converts 144 parallel timeouts into 90s of sequential
 *      timeouts; it does not make the sweep fit. The budget stops starting new
 *      work once it elapses, so the collector returns partial, clearly-labelled
 *      signals instead of overrunning its own tick.
 *
 * Both are reusable by the other PeerDB readers (the insights collector is the
 * obvious next caller), so they live outside `alert-collector.ts`.
 *
 * A third reader here, {@link resolvePeerDBSweepMaxMirrors}, is NOT a bound on
 * work but a coverage guard: the old hardcoded 50-mirror cap silently dropped
 * the rest of the fleet, which is why it now defaults to no guard at all and
 * reports any truncation as a partial result (#3687).
 *
 * Deliberately dependency-free — no `@chm/logger`, no `peerdb-config` — so the
 * alert collector can import it statically without pulling in the
 * node-built-in-dependent fetch client. Env reads are therefore local and
 * fail-soft (never throw on a malformed value).
 */

/** Pool width used when `PEERDB_SWEEP_CONCURRENCY` is unset or unusable. */
export const DEFAULT_PEERDB_SWEEP_CONCURRENCY = 8

/**
 * Hard ceiling on the pool. A typo must not be able to restore the unbounded
 * fan-out this module exists to remove, so the env value is clamped here.
 */
export const PEERDB_SWEEP_MAX_CONCURRENCY = 32

/** Wall-clock budget for one PeerDB collection when unset or unusable. */
export const DEFAULT_PEERDB_SWEEP_BUDGET_MS = 60_000

/** Budget floor — below this a sweep cannot do anything useful. */
export const MIN_PEERDB_SWEEP_BUDGET_MS = 1_000

/** Budget ceiling — well inside the 10-minute health-sweep cron interval. */
export const MAX_PEERDB_SWEEP_BUDGET_MS = 300_000

/** Env reader; defaults to `process.env`. Injected in tests. */
export type PeerDBEnvLookup = (name: string) => string | undefined

function defaultEnvLookup(): PeerDBEnvLookup {
  return (name) => {
    try {
      if (typeof process === 'undefined' || !process.env) return undefined
      return process.env[name]
    } catch {
      return undefined
    }
  }
}

function readInt(
  get: PeerDBEnvLookup | undefined,
  name: string
): number | null {
  const raw = (get ?? defaultEnvLookup())(name)?.trim()
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.floor(parsed) : null
}

/**
 * Pool width for the per-mirror fan-out, from `PEERDB_SWEEP_CONCURRENCY`.
 * Unset, unparseable, `< 1`, or above {@link PEERDB_SWEEP_MAX_CONCURRENCY} all
 * resolve to a bounded default rather than "unlimited".
 */
export function resolvePeerDBSweepConcurrency(get?: PeerDBEnvLookup): number {
  const parsed = readInt(get, 'PEERDB_SWEEP_CONCURRENCY')
  if (parsed === null || parsed < 1) return DEFAULT_PEERDB_SWEEP_CONCURRENCY
  return Math.min(parsed, PEERDB_SWEEP_MAX_CONCURRENCY)
}

/**
 * Optional guard on how many items one sweep reads, from
 * `PEERDB_SWEEP_MAX_MIRRORS`. `null` means NO guard — the default (#3687).
 *
 * This is deliberately NOT a ceiling, and deliberately fails open:
 *
 *   - unset / unparseable / below 1 → `null` (read the whole listing);
 *   - otherwise the parsed integer is used as an operator's ceiling.
 *
 * Fail-open is the right direction for a coverage bound: the wall-clock budget
 * and the pool already cap the work, so a bad value cannot make this lane
 * expensive, whereas a default cap silently drops mirrors and makes an outage
 * invisible. There is also no hard maximum on the value, unlike
 * {@link resolvePeerDBSweepConcurrency} — a large guard cannot restore
 * unbounded fan-out, because concurrency is bounded independently. Any
 * truncation this guard does cause is reported as a partial result (see
 * `sweep-coverage.ts`), never silently.
 */
export function resolvePeerDBSweepMaxMirrors(
  get?: PeerDBEnvLookup
): number | null {
  const parsed = readInt(get, 'PEERDB_SWEEP_MAX_MIRRORS')
  if (parsed === null || parsed < 1) return null
  return parsed
}

/**
 * Wall-clock budget for one PeerDB collection, from `PEERDB_SWEEP_BUDGET_MS`,
 * clamped to [`MIN_PEERDB_SWEEP_BUDGET_MS`, `MAX_PEERDB_SWEEP_BUDGET_MS`].
 */
export function resolvePeerDBSweepBudgetMs(get?: PeerDBEnvLookup): number {
  const parsed = readInt(get, 'PEERDB_SWEEP_BUDGET_MS')
  if (parsed === null) return DEFAULT_PEERDB_SWEEP_BUDGET_MS
  return Math.min(
    Math.max(parsed, MIN_PEERDB_SWEEP_BUDGET_MS),
    MAX_PEERDB_SWEEP_BUDGET_MS
  )
}

/** Wall-clock budget for one PeerDB collection, resolved from options/env. */
export interface SweepBudget {
  /** Aborts when the budget elapses; pass to the reader and the pool. */
  readonly signal: AbortSignal
  /** True once the budget has elapsed. */
  readonly expired: boolean
  /**
   * Clear the timer. ALWAYS call this in a `finally` — a live timer keeps the
   * process alive after the work is done (node tests would hang on it).
   */
  dispose(): void
}

/**
 * Start a wall-clock budget. After `budgetMs` the signal aborts, which stops
 * {@link mapWithPool} from starting further items and (when the reader forwards
 * the signal to fetch) cancels the in-flight calls.
 */
export function startSweepBudget(budgetMs: number): SweepBudget {
  const controller = new AbortController()
  const ms = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : 0
  const timer = setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    get expired() {
      return controller.signal.aborted
    },
    dispose() {
      clearTimeout(timer)
    },
  }
}

/** Result slot for one pooled item. */
export type PoolOutcome<T> =
  | { kind: 'done'; value: T }
  /** Never started: the budget elapsed before this item got a worker. */
  | { kind: 'aborted' }

/**
 * Map `items` with at most `limit` concurrent invocations of `fn`, preserving
 * input order in the result array.
 *
 * Guarantees:
 * - peak in-flight `fn` calls never exceeds `limit`;
 * - items are pulled in order, so an early abort leaves the TAIL `aborted`
 *   rather than an arbitrary subset;
 * - when `signal` is already aborted (or aborts mid-run) the remaining items
 *   come back as `{kind: 'aborted'}` instead of being silently dropped.
 *
 * `fn` must not throw — callers wrap it in their own best-effort guard (the
 * collector uses `safe()`), so a rejected `Promise.all` here can never strand
 * the other workers.
 */
export async function mapWithPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<PoolOutcome<R>[]> {
  const out: PoolOutcome<R>[] = items.map(() => ({ kind: 'aborted' }))
  if (items.length === 0) return out

  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return
      const index = next++
      if (index >= items.length) return
      const item = items[index] as T
      out[index] = { kind: 'done', value: await fn(item, index) }
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()))
  return out
}
