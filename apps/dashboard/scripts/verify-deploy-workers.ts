// Probes for the Workers deployed beside the dashboard (MCP, telemetry,
// cloud-hooks). verify-deploy.ts only reaches the dashboard worker, so a
// sibling that lost a binding stayed green: the preview telemetry Worker lost
// its D1 binding and GET /v1/summary answered 503 (#3246). Every probe is
// anonymous and read-only. Hard fail on 5xx or an unreachable worker; an
// unconfigured URL is an explicit SKIP, never a pass.

export interface WorkerProbeResult {
  worker: WorkerName
  name: string
  ok: boolean
  skipped?: boolean
  detail: string
}

export type HttpFn = (
  url: string
) => Promise<{ status: number; text: string; json: unknown }>

export type WorkerName = 'mcp' | 'telemetry' | 'hooks'
export type WorkerUrls = Partial<Record<WorkerName, string>>

const PROD_DASH = 'https://dash.chmonitor.dev'
const PREVIEW_DASH = 'https://preview.dash.chmonitor.dev'

// The worker URLs are fixed by each wrangler.toml route. cloud-hooks has no
// preview route, so there is nothing to probe on a preview deploy.
export function workerUrls(
  baseUrl: string,
  overrides: WorkerUrls = {}
): WorkerUrls {
  const base = baseUrl.replace(/\/$/, '')
  const known: WorkerUrls =
    base === PROD_DASH
      ? {
          mcp: PROD_DASH,
          telemetry: 'https://telemetry.chmonitor.dev',
          hooks: 'https://hooks.chmonitor.dev',
        }
      : base === PREVIEW_DASH
        ? {
            mcp: PREVIEW_DASH,
            telemetry: 'https://preview.telemetry.chmonitor.dev',
          }
        : {}
  return { ...known, ...overrides }
}

type Judge = (r: { status: number; json: unknown }) => {
  ok: boolean
  detail: string
}

const expect200: Judge = ({ status }) =>
  status === 200
    ? { ok: true, detail: 'HTTP 200' }
    : { ok: false, detail: `HTTP ${status}` }

const not5xx: Judge = ({ status }) =>
  status >= 500
    ? { ok: false, detail: `HTTP ${status}` }
    : { ok: true, detail: `HTTP ${status}` }

async function probe(
  worker: WorkerName,
  baseUrl: string | undefined,
  path: string,
  http: HttpFn,
  judge: Judge
): Promise<WorkerProbeResult> {
  const name = `${worker} GET ${path}`
  if (!baseUrl) {
    return {
      worker,
      name,
      ok: true,
      skipped: true,
      detail: `SKIPPED — no ${worker} URL configured for this target; worker not verified`,
    }
  }
  try {
    const r = await http(`${baseUrl.replace(/\/$/, '')}${path}`)
    return { worker, name, ...judge(r) }
  } catch (e) {
    return { worker, name, ok: false, detail: `unreachable — ${String(e)}` }
  }
}

export async function runWorkerProbes(
  urls: WorkerUrls,
  http: HttpFn
): Promise<WorkerProbeResult[]> {
  return Promise.all([
    probe('mcp', urls.mcp, '/api/v1/mcp/info', http, ({ status, json }) => {
      if (status !== 200) return { ok: false, detail: `HTTP ${status}` }
      const tools = (json as { tools?: unknown } | null)?.tools
      return Array.isArray(tools) && tools.length > 0
        ? { ok: true, detail: `${tools.length} tools listed` }
        : { ok: false, detail: 'HTTP 200 but no tools array' }
    }),
    // Anonymous callers get 401 here; only a 5xx means the worker is broken.
    probe('mcp', urls.mcp, '/api/mcp', http, not5xx),
    probe('telemetry', urls.telemetry, '/health', http, expect200),
    // 503 here is the lost CHM_TELEMETRY_DB D1 binding (#3246).
    probe(
      'telemetry',
      urls.telemetry,
      '/v1/summary',
      http,
      ({ status, json }) => {
        if (status !== 200)
          return {
            ok: false,
            detail: `HTTP ${status} — CHM_TELEMETRY_DB D1 binding missing or query failing`,
          }
        return (json as { enabled?: unknown } | null)?.enabled === true
          ? { ok: true, detail: 'enabled=true' }
          : { ok: false, detail: 'HTTP 200 but enabled is not true' }
      }
    ),
    probe('hooks', urls.hooks, '/healthz', http, expect200),
    // Reads the CHM_HOOKS_KV binding; a 5xx means the binding is gone.
    probe('hooks', urls.hooks, '/licenses/public', http, ({ status, json }) => {
      if (status !== 200)
        return {
          ok: false,
          detail: `HTTP ${status} — CHM_HOOKS_KV binding missing or read failing`,
        }
      return Array.isArray((json as { licenses?: unknown } | null)?.licenses)
        ? { ok: true, detail: 'licenses array returned' }
        : { ok: false, detail: 'HTTP 200 but no licenses array' }
    }),
  ])
}

export async function fetchHttp(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON */
  }
  return { status: res.status, text, json }
}

// CLI: bun scripts/verify-deploy-workers.ts --base-url URL
//        [--only mcp,telemetry] [--mcp-url U] [--telemetry-url U] [--hooks-url U]
// `--only` limits the run to the workers a CI job just deployed.
if (import.meta.main) {
  const args = process.argv.slice(2)
  const flag = (n: string) => {
    const i = args.indexOf(`--${n}`)
    return i !== -1 ? args[i + 1] : undefined
  }
  const urls = workerUrls(flag('base-url') ?? PROD_DASH, {
    ...(flag('mcp-url') ? { mcp: flag('mcp-url') } : {}),
    ...(flag('telemetry-url') ? { telemetry: flag('telemetry-url') } : {}),
    ...(flag('hooks-url') ? { hooks: flag('hooks-url') } : {}),
  })
  const only = flag('only')?.split(',')
  const results = (await runWorkerProbes(urls, fetchHttp)).filter(
    (r) => !only || only.includes(r.worker)
  )
  for (const r of results)
    console.log(
      `${r.skipped ? '⏭️ ' : r.ok ? '✅' : '❌'} ${r.name} — ${r.detail}`
    )
  const failed = results.filter((r) => !r.ok)
  console.log(
    failed.length === 0
      ? `\n✅ workers OK (${results.filter((r) => r.skipped).length} skipped)`
      : `\n❌ ${failed.length} worker probe(s) failed`
  )
  process.exit(failed.length === 0 ? 0 : 1)
}
