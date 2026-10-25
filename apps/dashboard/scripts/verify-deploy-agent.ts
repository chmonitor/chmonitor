// Anonymous agent probes for verify-deploy.ts. They need no ClickHouse and no
// token, and every failure is a hard fail: #3733 (AnyRouter sign-in 502) and a
// stale guest default model (#3545, #3581) were both green in every other
// check and only a human noticed.

export interface AgentProbeResult {
  name: string
  ok: boolean
  // skipped: the route needs auth on this deployment, so the probe could not
  // run. Reported loudly; it is not evidence the agent works.
  skipped?: boolean
  detail: string
}

export type HttpFn = (
  path: string
) => Promise<{ status: number; text: string; json: unknown }>

const isAuthGate = (status: number) => status === 401 || status === 403

async function probe(
  name: string,
  path: string,
  http: HttpFn,
  judge: (r: { status: number; json: unknown }) => {
    ok: boolean
    detail: string
  }
): Promise<AgentProbeResult> {
  try {
    const r = await http(path)
    if (isAuthGate(r.status)) {
      return {
        name,
        ok: true,
        skipped: true,
        detail: `SKIPPED — HTTP ${r.status}, route needs auth on this deployment; agent not verified`,
      }
    }
    return { name, ...judge(r) }
  } catch (e) {
    return { name, ok: false, detail: String(e) }
  }
}

export async function runAgentProbes(
  http: HttpFn,
  guestDefaultModel: string
): Promise<AgentProbeResult[]> {
  return Promise.all([
    probe(
      'GET /api/v1/agents/config-check (apiKey configured)',
      '/api/v1/agents/config-check',
      http,
      ({ status, json }) => {
        const apiKey = (json as { configured?: { apiKey?: unknown } } | null)
          ?.configured?.apiKey
        if (status !== 200) return { ok: false, detail: `HTTP ${status}` }
        return apiKey === true
          ? { ok: true, detail: 'configured.apiKey=true' }
          : {
              ok: false,
              detail: `configured.apiKey=${JSON.stringify(apiKey)} — no LLM provider key on the deployment, the agent cannot answer`,
            }
      }
    ),
    probe(
      `GET /api/v1/agents/models (lists guest default ${guestDefaultModel})`,
      '/api/v1/agents/models',
      http,
      ({ status, json }) => {
        if (status !== 200) return { ok: false, detail: `HTTP ${status}` }
        const models = (json as { models?: Array<{ id?: unknown }> } | null)
          ?.models
        if (!Array.isArray(models))
          return { ok: false, detail: 'response has no models array' }
        return models.some((m) => m?.id === guestDefaultModel)
          ? { ok: true, detail: `listed (${models.length} models)` }
          : {
              ok: false,
              detail: `MISSING — guest default ${guestDefaultModel} not among ${models.length} models; guests get an error instead of an answer`,
            }
      }
    ),
    probe(
      'GET /api/v1/agents/anyrouter/login (not 5xx)',
      '/api/v1/agents/anyrouter/login',
      http,
      ({ status }) =>
        status >= 500
          ? {
              ok: false,
              detail: `HTTP ${status} — AnyRouter sign-in start is broken (#3733)`,
            }
          : { ok: true, detail: `HTTP ${status}` }
    ),
  ])
}
