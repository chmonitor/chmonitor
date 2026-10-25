/**
 * Pure classification for scripts/smoke-prod.ts: turns raw probe results into
 * findings. Kept free of I/O so it can be unit-tested.
 */

export type ProbeKind = 'page' | 'asset' | 'health' | 'auth' | 'chart' | 'table'

export interface Probe {
  kind: ProbeKind
  name: string
  method: string
  path: string
  /** 0 when the request never got a response (timeout / network). */
  status: number
  ms: number
  body: string
  /** Set when fetch threw. */
  error?: string
  /** For `auth` probes: the status range the caller must get. */
  expect?: 'unauthorized'
}

export type Verdict = 'pass' | 'fail' | 'skip' | 'upstream'

export interface Result {
  probe: Probe
  verdict: Verdict
  reason: string
}

export interface Finding {
  key: string
  /** `warn` findings (slow responses) are reported but do not fail the run. */
  severity: 'fail' | 'warn'
  title: string
  count: number
  examples: string[]
}

export const SLOW_MS = {
  page: 3000,
  asset: 3000,
  health: 3000,
  auth: 3000,
  chart: 10_000,
  table: 10_000,
} as const

function parse(body: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(body)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function errorMessage(json: Record<string, unknown> | null): string {
  const e = json?.error
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as { type?: string; message?: string }
    return [o.type, o.message].filter(Boolean).join(': ')
  }
  return ''
}

/**
 * Classify one probe. `upstreamDown` is the host-status verdict for the demo
 * host: when it is down, a data probe that fails with a ClickHouse query error
 * is attributed to the upstream instead of counted as its own regression.
 */
export function classify(p: Probe, upstreamDown: boolean): Result {
  const r = (verdict: Verdict, reason: string): Result => ({
    probe: p,
    verdict,
    reason,
  })
  if (p.status === 0) {
    if ((p.kind === 'chart' || p.kind === 'table') && upstreamDown)
      return r('upstream', `no response (${p.error ?? 'timeout'})`)
    return r('fail', `no response: ${p.error ?? 'timeout'}`)
  }
  const json = parse(p.body)

  switch (p.kind) {
    case 'page':
      if (p.status !== 200) return r('fail', `HTTP ${p.status}`)
      if (!/<html/i.test(p.body) || !/\/assets\/[\w.-]+\.js/.test(p.body))
        return r('fail', 'HTML has no app shell / entry bundle')
      return r('pass', 'app shell')
    case 'asset':
      return p.status === 200 ? r('pass', 'ok') : r('fail', `HTTP ${p.status}`)
    case 'health':
      if (p.status !== 200) return r('fail', `HTTP ${p.status}`)
      if (json && 'deployment' in json)
        return r('fail', 'deployment metadata leaked to anonymous caller')
      return r('pass', 'ok')
    case 'auth':
      if (p.status === 401 || p.status === 403) return r('pass', `${p.status}`)
      return r(
        'fail',
        `anonymous write answered HTTP ${p.status}, expected 401/403`
      )
    case 'chart':
    case 'table': {
      const msg = errorMessage(json)
      if (p.status >= 200 && p.status < 300) {
        if (!json) return r('fail', `HTTP ${p.status} with non-JSON body`)
        if (json.success === false)
          return upstreamDown
            ? r('upstream', msg)
            : r('fail', `success:false ${msg}`)
        return r('pass', 'ok')
      }
      // A 4xx validation answer means the config needs params the smoke does
      // not know (e.g. a database/table name); it is not a prod regression.
      if (p.status === 400 || p.status === 422)
        return r('skip', `needs params: ${msg}`)
      if (p.status >= 500 && upstreamDown)
        return r('upstream', msg || `HTTP ${p.status}`)
      return r('fail', `HTTP ${p.status} ${msg}`.trim())
    }
  }
}

/**
 * Group results into findings. Every upstream-attributed probe collapses into
 * ONE `warn` finding so a demo outage (#3825) reads as one problem, not N
 * charts, and does not mask a real page/asset/auth failure: only `fail`
 * verdicts (never `upstream` ones) make the run fail.
 */
export function summarize(results: Result[]): Finding[] {
  const map = new Map<string, Finding>()
  const add = (
    key: string,
    severity: Finding['severity'],
    title: string,
    example: string
  ) => {
    const f = map.get(key) ?? { key, severity, title, count: 0, examples: [] }
    f.count++
    if (f.examples.length < 5) f.examples.push(example)
    map.set(key, f)
  }
  for (const { probe: p, verdict, reason } of results) {
    if (verdict === 'upstream') {
      add(
        'upstream',
        'warn',
        'Demo ClickHouse unreachable (host-status down); data probes cannot be evaluated',
        `${p.kind} ${p.name}: ${reason}`
      )
    } else if (verdict === 'fail') {
      add(
        `${p.kind}:${p.name}`,
        'fail',
        `${p.kind} ${p.name} (${p.method} ${p.path}): ${reason}`,
        reason
      )
    } else if (verdict === 'pass' && p.ms > SLOW_MS[p.kind]) {
      add(
        `slow:${p.kind}:${p.name}`,
        'warn',
        `${p.kind} ${p.name} slow: ${p.ms}ms > ${SLOW_MS[p.kind]}ms`,
        `${p.ms}ms`
      )
    }
  }
  return [...map.values()]
}

/** Host-status counts as down when it answers a structured 5xx or never answers. */
export function hostStatusDown(p: Probe): boolean {
  if (p.status === 0) return true
  const json = parse(p.body)
  return p.status >= 500 && json?.success === false
}
