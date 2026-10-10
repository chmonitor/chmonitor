/**
 * Cleanup Endpoint — POST /api/clean
 *
 * Kills long-running hang queries (>10 min with zero read_rows) via the
 * monitoring user, then records a LastCleanup + SystemKillQuery event.
 * Skips if the last cleanup happened within QUERY_CLEANUP_MAX_DURATION_SECONDS.
 *
 * Ported from apps/dashboard/app/api/clean/route.ts.
 * - ErrorLogger replaced with @chm/logger debug/error.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { getClient } from '@chm/clickhouse-client'
import { debug, error } from '@chm/logger'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { parseHostIdParam } from '@/lib/api/shared/validators/host-id'
import { EVENTS_TABLE } from '@/lib/app-tables'
import { bridgeApiKeyEnv, isAuthenticatedRequest } from '@/lib/auth/api-guard'

const QUERY_CLEANUP_MAX_DURATION_SECONDS = 10 * 60 // 10 minutes
const MONITORING_USER = () => process.env.CLICKHOUSE_USER || ''

type KillQueryRow = { kill_status: string; query_id: string; user: string }

type KillQueryResponse = {
  meta: object[]
  data: KillQueryRow[]
  rows: number
  statistics: object
}

type CHClient = Awaited<ReturnType<typeof getClient>>

async function getLastCleanup(client: CHClient): Promise<[Date, Date]> {
  try {
    const response = await client.query({
      query: `
        SELECT max(event_time) as last_cleanup,
               now() as now
        FROM ${EVENTS_TABLE}
        WHERE kind = 'LastCleanup'
      `,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 15 },
    })
    const data: { last_cleanup: string; now: string }[] = await response.json()
    const lastCleanup = new Date(data[0].last_cleanup)
    const now = new Date(data[0].now)
    debug(`[/api/clean] Last cleanup: ${lastCleanup}, now: ${now}`)
    return [lastCleanup, now]
  } catch (err) {
    throw new Error(`Error when getting last cleanup: ${err}`)
  }
}

function shouldCleanup(lastCleanup: Date, now: Date): boolean {
  return (
    now.getTime() - lastCleanup.getTime() >=
    QUERY_CLEANUP_MAX_DURATION_SECONDS * 1000
  )
}

async function killHangingQueries(
  client: CHClient
): Promise<KillQueryResponse | null> {
  try {
    const resp = await client.query({
      query: `
        KILL QUERY
        WHERE user = currentUser()
          AND read_rows = 0
          AND elapsed > {maxDuration: UInt32}
        ASYNC
      `,
      format: 'JSON',
      query_params: { maxDuration: QUERY_CLEANUP_MAX_DURATION_SECONDS },
    })
    const killQueryResp = (await resp.json()) as unknown as KillQueryResponse
    debug('[/api/clean] queries found', {
      queryIds: killQueryResp.data.map((r) => r.query_id).join(', '),
    })
    return killQueryResp
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('Unexpected end of JSON input')
    ) {
      debug('[/api/clean] Done, nothing to cleanup')
      return null
    }
    throw new Error(`Error when killing queries: ${err}`)
  }
}

async function updateLastCleanup(client: CHClient): Promise<void> {
  try {
    await client.insert({
      table: EVENTS_TABLE,
      values: [{ kind: 'LastCleanup', actor: MONITORING_USER() }],
      format: 'JSONEachRow',
    })
    debug('[/api/clean] LastCleanup event created')
  } catch (err) {
    error('[/api/clean] LastCleanup event error', err as Error)
    throw new Error(`'LastCleanup' event creating error: ${err}`)
  }
}

async function createSystemKillQueryEvent(
  client: CHClient,
  killQueryResp: KillQueryResponse
): Promise<void> {
  try {
    const killStatus = killQueryResp.data.reduce(
      (acc, row) => {
        acc[row.kill_status] = (acc[row.kill_status] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )
    const value = {
      kind: 'SystemKillQuery',
      actor: MONITORING_USER(),
      data: `Detected ${killQueryResp.rows} hang queries (>${QUERY_CLEANUP_MAX_DURATION_SECONDS}s), killing them, result: ${JSON.stringify(killStatus)}`,
    }
    await client.insert({
      table: EVENTS_TABLE,
      format: 'JSONEachRow',
      values: [value],
    })
  } catch (err) {
    error('[/api/clean] SystemKillQuery event error', err as Error)
  }
}

async function cleanupHangQuery(
  client: CHClient
): Promise<{ lastCleanup: Date; message: string }> {
  const [lastCleanup, now] = await getLastCleanup(client)

  if (!shouldCleanup(lastCleanup, now)) {
    return {
      lastCleanup,
      message: `Not triggering cleanup, last ${lastCleanup.toISOString()}, now: ${now.toISOString()}, QUERY_CLEANUP_MAX_DURATION_SECONDS=${QUERY_CLEANUP_MAX_DURATION_SECONDS}s`,
    }
  }

  debug('[/api/clean] Starting clean up hang queries')

  const killQueryResp = await killHangingQueries(client)
  await updateLastCleanup(client)

  if (!killQueryResp || killQueryResp.rows === 0) {
    debug('[/api/clean] Done, nothing to cleanup')
    return { lastCleanup, message: 'Nothing to cleanup' }
  }

  await createSystemKillQueryEvent(client, killQueryResp)
  return { lastCleanup, message: 'Cleanup completed' }
}

export const Route = createFileRoute('/api/clean')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)
        bridgeApiKeyEnv(env as Record<string, string | undefined>)

        // Mutating endpoint (KILL QUERY): require a genuinely authenticated
        // caller. isAuthenticatedRequest() intentionally ignores public-read,
        // so anonymous callers cannot reach it in cloud public-read mode.
        if (!(await isAuthenticatedRequest(request))) {
          return Response.json(
            { error: 'Authentication required' },
            { status: 401 }
          )
        }

        const searchParams = new URL(request.url).searchParams
        const hostIdRaw = searchParams.get('hostId')
        if (!hostIdRaw) {
          return Response.json(
            { error: 'Missing required parameter: hostId' },
            { status: 400 }
          )
        }

        const hostId = parseHostIdParam(hostIdRaw)
        if (Number.isNaN(hostId) || hostId < 0) {
          return Response.json(
            { error: 'Invalid hostId: must be a non-negative number' },
            { status: 400 }
          )
        }

        try {
          const client = await getClient({ hostId })
          const resp = await cleanupHangQuery(client)
          return Response.json({ status: true, ...resp }, { status: 200 })
        } catch (err) {
          error('[/api/clean] Handler error', err as Error)
          return Response.json(
            { status: false, error: 'Internal server error' },
            { status: 500 }
          )
        }
      },
    },
  },
})
