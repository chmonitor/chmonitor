/**
 * Health probes — HTTP checks of the public Cloud surfaces, run every 15 min by
 * cron. State is stored per-probe in KV so we notify ONLY on transitions
 * (up→down / down→up), never on every run — otherwise a healthy fleet would
 * page the operator every 15 minutes.
 */

import type { NotifyKind } from './telegram'

export type ProbeState = 'up' | 'down'

/**
 * A validator decides whether an HTTP response counts as "up". Returning true is
 * up; false is down. Kept as a named function so the probe table reads
 * declaratively (name/url/kind/validator) — adding a surface is data, not code.
 */
export type ProbeValidator = (res: Response) => boolean

/** 2xx only — the default for a plain reachability check. */
export const expectOk: ProbeValidator = (res) => res.ok

/**
 * Not a 5xx. For endpoints that legitimately answer 4xx to a bare GET (e.g. an
 * MCP JSON-RPC endpoint returning 401/405) — we only care that the server is
 * answering, not erroring.
 */
export const expectNotServerError: ProbeValidator = (res) => res.status < 500

/** Human labels for the kinds of surface we probe (documentation only). */
export type ProbeKind = 'http' | 'readiness' | 'rpc' | 'd1'

export interface ProbeTarget {
  name: string
  url: string
  /** What sort of surface this is — documentation for the probe table. */
  kind?: ProbeKind
  /** How to judge the response. Defaults to `expectOk` (2xx). */
  validator?: ProbeValidator
}

export interface ProbeResult {
  name: string
  state: ProbeState
  status?: number
  error?: string
}

export interface Transition {
  name: string
  from: ProbeState | 'unknown'
  to: ProbeState
  status?: number
  error?: string
}

/**
 * The public surfaces we monitor — a declarative table. Each row is (name, url,
 * kind, validator); adding a surface is a new row, not new code.
 *
 * - `dashboard` (`/healthz`) — static liveness shell (no deps).
 * - `dashboard-ready` (`/api/healthz`) — ClickHouse-gated readiness (a 200 means
 *   the app can reach its configured hosts, not just that the Worker is up).
 * - `docs` / `landing` / `blog` — the marketing + docs sites.
 * - `mcp` (`/api/mcp`) — the MCP JSON-RPC endpoint. A bare GET legitimately
 *   answers 4xx (401/405), so we assert only "not a 5xx".
 */
export const DEFAULT_TARGETS: ProbeTarget[] = [
  {
    name: 'dashboard',
    url: 'https://dash.chmonitor.dev/healthz',
    kind: 'http',
    validator: expectOk,
  },
  {
    name: 'dashboard-ready',
    url: 'https://dash.chmonitor.dev/api/healthz',
    kind: 'readiness',
    validator: expectOk,
  },
  { name: 'docs', url: 'https://docs.chmonitor.dev', kind: 'http' },
  { name: 'landing', url: 'https://chmonitor.dev', kind: 'http' },
  { name: 'blog', url: 'https://blog.chmonitor.dev', kind: 'http' },
  {
    name: 'mcp',
    url: 'https://dash.chmonitor.dev/api/mcp',
    kind: 'rpc',
    validator: expectNotServerError,
  },
]

/**
 * Probe one target. The target's `validator` (default `expectOk`) judges the
 * response; a fetch rejection is always "down". Never throws — a rejection is a
 * "down" result, not a crash.
 */
export async function probeOne(
  target: ProbeTarget,
  fetchImpl: typeof fetch = fetch
): Promise<ProbeResult> {
  const validator = target.validator ?? expectOk
  try {
    const res = await fetchImpl(target.url, {
      method: 'GET',
      redirect: 'follow',
    })
    return validator(res)
      ? { name: target.name, state: 'up', status: res.status }
      : { name: target.name, state: 'down', status: res.status }
  } catch (err) {
    return {
      name: target.name,
      state: 'down',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Minimal D1 subset for the read probe (`SELECT 1`). */
export interface D1ProbeDb {
  prepare(sql: string): { first<T = unknown>(): Promise<T | null> }
}

/**
 * D1 read probe — `SELECT 1` through the bound CHM_CLOUD_D1. A successful round
 * trip is "up"; any error is "down". Never throws.
 */
export async function probeD1(
  db: D1ProbeDb,
  name = 'd1'
): Promise<ProbeResult> {
  try {
    await db.prepare('SELECT 1 AS ok').first()
    return { name, state: 'up' }
  } catch (err) {
    return {
      name,
      state: 'down',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Pure transition detector. Given the previous known state per probe and the
 * current results, return only the probes whose state CHANGED.
 *
 * First-seen semantics: an unknown prior state notifies only when the current
 * state is `down` (a surface that starts down is worth an alert; one that
 * starts up is the boring steady state and stays silent).
 */
export function diffStates(
  prev: Record<string, ProbeState>,
  current: ProbeResult[]
): Transition[] {
  const transitions: Transition[] = []
  for (const result of current) {
    const before = prev[result.name]
    if (before === undefined) {
      if (result.state === 'down') {
        transitions.push({
          name: result.name,
          from: 'unknown',
          to: 'down',
          status: result.status,
          error: result.error,
        })
      }
      continue
    }
    if (before !== result.state) {
      transitions.push({
        name: result.name,
        from: before,
        to: result.state,
        status: result.status,
        error: result.error,
      })
    }
  }
  return transitions
}

export function formatTransition(t: Transition): string {
  const icon = t.to === 'down' ? '\u{1F534}' : '\u{1F7E2}' // 🔴 / 🟢
  const detail = t.status
    ? ` (HTTP ${t.status})`
    : t.error
      ? ` (${t.error})`
      : ''
  return `${icon} <b>${t.name}</b> is ${t.to.toUpperCase()}${detail}`
}

export const PROBE_NOTIFY_KIND: NotifyKind = 'probe'

/** Minimal KV subset used to persist probe state between cron runs. */
export interface KVLike {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

const KV_KEY = 'probe-state:v1'

/**
 * Read the last-known per-surface up/down state persisted by `runProbes`. Used
 * by the daily digest for a per-surface status summary without re-probing. No
 * KV / no stored state / a parse error → null (the digest omits the section).
 */
export async function readProbeSnapshot(
  kv: KVLike | null | undefined
): Promise<Record<string, ProbeState> | null> {
  if (!kv) return null
  try {
    const raw = await kv.get(KV_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Record<string, ProbeState>
  } catch (err) {
    console.error('[cloud-hooks] failed to read probe snapshot from KV', err)
    return null
  }
}

export interface RunProbesDeps {
  fetch?: typeof fetch
  kv?: KVLike | null
  targets?: ProbeTarget[]
  /** Optional D1 binding — when present, a `SELECT 1` read probe is added. */
  d1?: D1ProbeDb | null
  notify: (kind: NotifyKind, text: string) => Promise<boolean>
  logError?: (message: string, meta?: unknown) => void
}

/**
 * Run all probes, notify on transitions only, and persist the new state to KV.
 * Returns the transitions that were reported (for logging / tests).
 */
export async function runProbes(deps: RunProbesDeps): Promise<Transition[]> {
  const fetchImpl = deps.fetch ?? fetch
  const targets = deps.targets ?? DEFAULT_TARGETS
  const logError = deps.logError ?? ((m, meta) => console.error(m, meta))

  let prev: Record<string, ProbeState> = {}
  if (deps.kv) {
    try {
      const raw = await deps.kv.get(KV_KEY)
      if (raw) prev = JSON.parse(raw) as Record<string, ProbeState>
    } catch (err) {
      logError('[cloud-hooks] failed to read probe state from KV', { err })
    }
  }

  const results = await Promise.all(targets.map((t) => probeOne(t, fetchImpl)))
  if (deps.d1) {
    results.push(await probeD1(deps.d1))
  }
  const transitions = diffStates(prev, results)

  for (const t of transitions) {
    await deps.notify(PROBE_NOTIFY_KIND, formatTransition(t))
  }

  const nextState: Record<string, ProbeState> = {}
  for (const r of results) nextState[r.name] = r.state
  if (deps.kv) {
    try {
      await deps.kv.put(KV_KEY, JSON.stringify(nextState))
    } catch (err) {
      logError('[cloud-hooks] failed to persist probe state to KV', { err })
    }
  }

  return transitions
}
