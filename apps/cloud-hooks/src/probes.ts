/**
 * Health probes — HTTP checks of the public Cloud surfaces, run every 15 min by
 * cron. State is stored per-probe in KV so we notify ONLY on transitions
 * (up→down / down→up), never on every run — otherwise a healthy fleet would
 * page the operator every 15 minutes.
 */

import type { NotifyKind } from './telegram'

export type ProbeState = 'up' | 'down'

export interface ProbeTarget {
  name: string
  url: string
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

/** The public surfaces we monitor. `/healthz` is the dashboard readiness shell. */
export const DEFAULT_TARGETS: ProbeTarget[] = [
  { name: 'dashboard', url: 'https://dash.chmonitor.dev/healthz' },
  { name: 'docs', url: 'https://docs.chmonitor.dev' },
  { name: 'landing', url: 'https://chmonitor.dev' },
]

/**
 * Probe one target. A 2xx response is "up"; any non-2xx or network error is
 * "down". Never throws — a fetch rejection is a "down" result, not a crash.
 */
export async function probeOne(
  target: ProbeTarget,
  fetchImpl: typeof fetch = fetch
): Promise<ProbeResult> {
  try {
    const res = await fetchImpl(target.url, {
      method: 'GET',
      redirect: 'follow',
    })
    return res.ok
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

export interface RunProbesDeps {
  fetch?: typeof fetch
  kv?: KVLike | null
  targets?: ProbeTarget[]
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
