/**
 * Extracts the fields chmonitor stores from a GitHub `deployment` /
 * `deployment_status` webhook payload.
 *
 * Both event types carry a top-level `deployment` object (deployment_status
 * additionally carries a sibling `deployment_status` object, which this
 * doesn't need — repo/environment/ref/sha/created_at all live on
 * `deployment`, so one extractor covers both event types). The event type
 * itself is NOT in the JSON body — the caller (routes/api/v1/webhooks/github.ts)
 * reads it from the `X-GitHub-Event` header.
 */

export interface ParsedGithubDeployment {
  /** GitHub's deployment id — the idempotency/dedupe key. */
  id: string
  repo: string
  environment: string | null
  ref: string | null
  sha: string | null
  /** Free-form version string from the deployment's custom `payload`, if set. */
  version: string | null
  /** Unix milliseconds. */
  createdAtMs: number
}

interface RawDeployment {
  id?: number | string
  sha?: string
  ref?: string
  environment?: string
  created_at?: string
  payload?: unknown
}

interface RawRepository {
  full_name?: string
}

interface RawDeploymentEvent {
  deployment?: RawDeployment
  repository?: RawRepository
}

/** Best-effort extraction of `{ version }` from a deployment's custom payload. */
function extractVersion(rawPayload: unknown): string | null {
  let value = rawPayload
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (value && typeof value === 'object' && 'version' in value) {
    const version = (value as Record<string, unknown>).version
    if (typeof version === 'string') return version
    if (version != null) return String(version)
  }
  return null
}

/**
 * Parses a `deployment` / `deployment_status` webhook body. Returns null when
 * the payload is missing the fields chmonitor requires (deployment id,
 * repository full_name, a parseable created_at) — the caller treats null as a
 * 400, never a partial/best-guess row.
 */
export function parseGithubDeploymentEvent(
  body: unknown
): ParsedGithubDeployment | null {
  if (typeof body !== 'object' || body === null) return null

  const { deployment, repository } = body as RawDeploymentEvent
  const repo = repository?.full_name
  if (!deployment || deployment.id === undefined || !repo) return null

  const createdAtMs = deployment.created_at
    ? Date.parse(deployment.created_at)
    : Number.NaN
  if (!Number.isFinite(createdAtMs)) return null

  return {
    id: String(deployment.id),
    repo,
    environment: deployment.environment ?? null,
    ref: deployment.ref ?? null,
    sha: deployment.sha ?? null,
    version: extractVersion(deployment.payload),
    createdAtMs,
  }
}
