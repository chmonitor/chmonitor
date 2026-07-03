/**
 * D1-backed store for GitHub deployment webhook events — the deploy markers
 * overlaid on the query-volume timeline (plans/45-github-deploy-correlation.md).
 *
 * Reuses the same `CHM_CLOUD_D1` binding as the agent's conversation store;
 * the table is created by the `github_deployments` migration in
 * `db/conversations-migrations`. Best-effort like the other insights-style D1
 * backends (baseline-store.ts, insights/store/d1-store.ts): a missing binding
 * or any D1 error is caught, logged, and resolved to false/[] rather than
 * thrown, so a deployment with no D1 configured (the OSS/self-hosted default
 * without CHM_CLOUD_D1) simply never persists deploy markers — the overlay
 * then renders nothing, which is the fail-open behavior this feature promises.
 *
 * All timestamps are unix milliseconds, matching how the chart overlay parses
 * `event_time` (`new Date(value).getTime()`).
 */
import { ErrorLogger } from '@chm/logger'
import { getPlatformBindings } from '@chm/platform'

const warn = (msg: string) =>
  ErrorLogger.logWarning(`[github-deployments-store] ${msg}`, {
    component: 'github-deployments-store',
  })

const TABLE = 'github_deployments'
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export interface DeploymentRecord {
  id: string
  ownerScope: string
  repo: string
  environment: string | null
  ref: string | null
  sha: string | null
  version: string | null
  createdAt: number
  receivedAt: number
}

interface D1DeploymentRow {
  id: string
  owner_scope: string
  repo: string
  environment: string | null
  ref: string | null
  sha: string | null
  version: string | null
  created_at: number
  received_at: number
}

function getDb(): D1Database | null {
  return getPlatformBindings().getD1Database('CHM_CLOUD_D1')
}

function rowToRecord(row: D1DeploymentRow): DeploymentRecord {
  return {
    id: row.id,
    ownerScope: row.owner_scope,
    repo: row.repo,
    environment: row.environment,
    ref: row.ref,
    sha: row.sha,
    version: row.version,
    createdAt: row.created_at,
    receivedAt: row.received_at,
  }
}

/**
 * Upsert a deployment keyed by GitHub's deployment id, so a webhook
 * redelivery (or a later `deployment_status` event for the same deployment)
 * updates the row in place instead of duplicating it. Best-effort: logs and
 * returns false on failure, never throws — the webhook route still 202s so
 * GitHub doesn't retry forever over this non-critical, observe-only write.
 */
export async function upsertDeployment(
  record: DeploymentRecord
): Promise<boolean> {
  try {
    const db = getDb()
    if (!db) return false

    await db
      .prepare(
        `INSERT INTO ${TABLE}
           (id, owner_scope, repo, environment, ref, sha, version, created_at, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (id) DO UPDATE SET
           owner_scope = excluded.owner_scope,
           repo = excluded.repo,
           environment = excluded.environment,
           ref = excluded.ref,
           sha = excluded.sha,
           version = excluded.version,
           created_at = excluded.created_at,
           received_at = excluded.received_at`
      )
      .bind(
        record.id,
        record.ownerScope,
        record.repo,
        record.environment,
        record.ref,
        record.sha,
        record.version,
        record.createdAt,
        record.receivedAt
      )
      .run()
    return true
  } catch (err) {
    warn(`failed to upsert deployment ${record.id}: ${err}`)
    return false
  }
}

export interface ListDeploymentsOptions {
  ownerScope?: string
  sinceMs?: number
  untilMs?: number
  limit?: number
}

/**
 * List deployments for a scope within an optional time range, most recent
 * first — feeds the read API (routes/api/v1/deployments.ts) that the chart
 * overlay fetches from. Best-effort — returns [] on any failure (missing
 * binding, D1 error, unmigrated table).
 */
export async function listDeployments(
  opts: ListDeploymentsOptions = {}
): Promise<DeploymentRecord[]> {
  try {
    const db = getDb()
    if (!db) return []

    const conditions: string[] = []
    const binds: (string | number)[] = []

    if (opts.ownerScope !== undefined) {
      conditions.push('owner_scope = ?')
      binds.push(opts.ownerScope)
    }
    if (opts.sinceMs !== undefined) {
      conditions.push('created_at >= ?')
      binds.push(opts.sinceMs)
    }
    if (opts.untilMs !== undefined) {
      conditions.push('created_at <= ?')
      binds.push(opts.untilMs)
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    binds.push(limit)

    const result = await db
      .prepare(
        `SELECT id, owner_scope, repo, environment, ref, sha, version, created_at, received_at
         FROM ${TABLE}
         ${where}
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .bind(...binds)
      .all<D1DeploymentRow>()

    return (result.results ?? []).map(rowToRecord)
  } catch (err) {
    warn(`failed to list deployments: ${err}`)
    return []
  }
}
