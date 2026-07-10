/**
 * Explain Query endpoint
 *
 * Executes EXPLAIN on the provided query and returns the execution plan.
 *
 *   GET  /api/v1/explain?hostId=0&query=SELECT...
 *   POST /api/v1/explain   { "hostId": 0, "query": "SELECT ..." }
 *
 * Ported from apps/dashboard/app/api/v1/explain/route.ts.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import {
  fetchData,
  getAndValidateClientConfig,
  getClient,
} from '@chm/clickhouse-client'
import { QUERY_COMMENT } from '@chm/clickhouse-client/constants'
import { debug, error as logError } from '@chm/logger'
import { stripTrailingFormat, validateSqlQuery } from '@chm/sql-builder'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import {
  demoHiddenUnavailable,
  isDemoHostBlockedForRequest,
} from '@/lib/cloud/reject-demo-host'

const ROUTE_CONTEXT = { route: '/api/v1/explain' }

/**
 * Valid ClickHouse EXPLAIN modes. Empty string maps to plain EXPLAIN (PLAN).
 */
const VALID_EXPLAIN_MODES = [
  '',
  'PIPELINE',
  'AST',
  'SYNTAX',
  'ESTIMATE',
] as const
type ExplainMode = (typeof VALID_EXPLAIN_MODES)[number]

const VALID_PLAN_SETTING_KEYS = new Set([
  'optimize',
  'header',
  'description',
  'indexes',
  'projections',
  'actions',
  'sorting',
  'keep_logical_steps',
  'json',
  'distributed',
])

const MAX_QUERY_LENGTH = 100000

/**
 * Parse and validate the planSettings parameter.
 * Expects comma-separated key=value pairs where value is 0 or 1.
 */
function parsePlanSettings(
  raw: string
): { clause: string } | { error: string } {
  if (!raw) return { clause: '' }

  const pairs = raw.split(',')
  const validated: string[] = []

  for (const pair of pairs) {
    const trimmed = pair.trim()
    if (!trimmed) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) {
      return {
        error: `Invalid plan setting format: "${trimmed}". Expected key=value.`,
      }
    }

    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()

    if (!VALID_PLAN_SETTING_KEYS.has(key)) {
      return {
        error: `Unknown plan setting: "${key}". Valid settings: ${Array.from(VALID_PLAN_SETTING_KEYS).join(', ')}`,
      }
    }

    if (value !== '0' && value !== '1') {
      return {
        error: `Invalid value for "${key}": "${value}". Must be 0 or 1.`,
      }
    }

    validated.push(`${key} = ${value}`)
  }

  if (validated.length === 0) return { clause: '' }
  return { clause: `${validated.join(', ')} ` }
}

/**
 * EXPLAIN AST and EXPLAIN SYNTAX return raw text that ClickHouse does not wrap
 * in JSONEachRow. Fetch as plain text and convert each line to {explain: string}.
 */
async function fetchExplainAsText(
  explainQuery: string,
  hostId: number
): Promise<
  | { data: { explain: string }[]; metadata: Record<string, string | number> }
  | { error: { type: string; message: string } }
> {
  let clientConfig
  try {
    clientConfig = getAndValidateClientConfig(hostId)
  } catch (err) {
    return {
      error: {
        type: 'validation_error',
        message: err instanceof Error ? err.message : String(err),
      },
    }
  }

  try {
    const client = await getClient({ clientConfig })
    const resultSet = await client.query({
      query: QUERY_COMMENT + explainQuery,
      format: 'TabSeparatedRaw',
    })
    const text = await resultSet.text()
    const lines = text.split('\n').filter((line) => line.length > 0)
    return {
      data: lines.map((line) => ({ explain: line })),
      metadata: {
        queryId: resultSet.query_id,
        sql: explainQuery,
        host: clientConfig.host,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      error: {
        type: 'query_error',
        message: `${msg} (host: ${hostId})`,
      },
    }
  }
}

/**
 * Run a ClickHouse EXPLAIN once request inputs have been collected.
 * Shared by the GET and POST handlers.
 */
async function runExplain(
  hostId: number,
  query: string | null,
  modeParam: string,
  planSettingsRaw: string
): Promise<Response> {
  // Cloud demo-hiding invariant (#2172 / #2488): user connections always use
  // negative hostIds, so a non-negative id from a signed-in cloud principal
  // can only be the hidden env/demo host. No-op for OSS and anonymous cloud
  // callers (both legitimately use hostId=0).
  if (
    await isDemoHostBlockedForRequest(
      hostId,
      env as Record<string, string | undefined>
    )
  ) {
    return Response.json(
      {
        success: true,
        data: [],
        metadata: {
          sql: '',
          rows: 0,
          queryId: '',
          unavailable: demoHiddenUnavailable(),
        },
      },
      { status: 200 }
    )
  }

  if (!query || query.trim() === '') {
    return Response.json(
      {
        success: false,
        error: 'Missing required parameter: query',
        ...ROUTE_CONTEXT,
      },
      { status: 400 }
    )
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return Response.json(
      {
        success: false,
        error: `Query is too long (maximum ${MAX_QUERY_LENGTH} characters)`,
        ...ROUTE_CONTEXT,
      },
      { status: 400 }
    )
  }

  // EXPLAIN cannot wrap a query that still carries a trailing `FORMAT <name>`
  // clause or a trailing `;` (ClickHouse rejects it). Strip them so queries
  // copied straight from the SQL console — e.g. `... FORMAT JSONEachRow` — can
  // be explained as-is.
  const normalizedQuery = stripTrailingFormat(query)

  if (normalizedQuery.trim() === '') {
    return Response.json(
      {
        success: false,
        error: 'Missing required parameter: query',
        ...ROUTE_CONTEXT,
      },
      { status: 400 }
    )
  }

  // SECURITY: Validate SQL query to prevent injection attacks
  try {
    validateSqlQuery(normalizedQuery)
  } catch (validationError) {
    logError('[/api/v1/explain] Security: SQL validation failed', {
      queryPreview: query.substring(0, 100),
      error:
        validationError instanceof Error
          ? validationError.message
          : 'Unknown error',
    })
    return Response.json(
      {
        success: false,
        error:
          validationError instanceof Error
            ? validationError.message
            : 'SQL validation failed',
        ...ROUTE_CONTEXT,
      },
      { status: 400 }
    )
  }

  if (modeParam && !VALID_EXPLAIN_MODES.includes(modeParam as ExplainMode)) {
    return Response.json(
      {
        success: false,
        error: `Invalid explain mode: ${modeParam}. Valid modes: ${VALID_EXPLAIN_MODES.filter(Boolean).join(', ')}`,
        ...ROUTE_CONTEXT,
      },
      { status: 400 }
    )
  }

  let settingsClause = ''

  if (planSettingsRaw && modeParam) {
    return Response.json(
      {
        success: false,
        error: 'planSettings cannot be combined with a non-PLAN explain mode',
        ...ROUTE_CONTEXT,
      },
      { status: 400 }
    )
  }

  if (planSettingsRaw && !modeParam) {
    const result = parsePlanSettings(planSettingsRaw)
    if ('error' in result) {
      return Response.json(
        { success: false, error: result.error, ...ROUTE_CONTEXT },
        { status: 400 }
      )
    }
    settingsClause = result.clause
  }

  debug('[/api/v1/explain]', {
    hostId,
    queryLength: query.length,
    mode: modeParam || 'PLAN',
    planSettings: settingsClause || '(defaults)',
  })

  // Build EXPLAIN query
  let explainQuery: string
  if (settingsClause) {
    explainQuery = `EXPLAIN PLAN ${settingsClause.trim()} ${normalizedQuery}`
  } else if (modeParam) {
    explainQuery = `EXPLAIN ${modeParam} ${normalizedQuery}`
  } else {
    explainQuery = `EXPLAIN ${normalizedQuery}`
  }

  // AST and SYNTAX modes return raw text, not valid JSONEachRow
  const isTextMode = modeParam === 'AST' || modeParam === 'SYNTAX'

  if (isTextMode) {
    const textResult = await fetchExplainAsText(explainQuery, hostId)

    if ('error' in textResult) {
      logError('[/api/v1/explain] Query error:', textResult.error)
      return Response.json(
        { success: false, error: textResult.error.message, ...ROUTE_CONTEXT },
        { status: 500 }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: textResult.data,
        metadata: {
          sql: explainQuery,
          rows: textResult.data.length,
          queryId: String(textResult.metadata.queryId || ''),
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    )
  }

  // PLAN, PIPELINE, ESTIMATE modes return valid JSONEachRow
  const result = await fetchData({
    query: explainQuery,
    hostId,
    format: 'JSONEachRow',
  })

  if (result.error) {
    logError('[/api/v1/explain] Query error:', result.error)
    return Response.json(
      { success: false, error: result.error.message, ...ROUTE_CONTEXT },
      { status: 500 }
    )
  }

  return new Response(
    JSON.stringify({
      success: true,
      data: result.data,
      metadata: {
        sql: explainQuery,
        rows: Number(result.metadata.rows || 0),
        duration: Number(result.metadata.duration || 0),
        queryId: String(result.metadata.queryId || ''),
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  )
}

/**
 * Validate required search parameters (hostId + query present and non-empty).
 */
function validateSearchParams(
  searchParams: URLSearchParams
): { message: string } | null {
  for (const param of ['hostId', 'query']) {
    const value = searchParams.get(param)
    if (!value || value.trim() === '') {
      return { message: `Missing required parameter: ${param}` }
    }
  }
  return null
}

/**
 * Parse and validate hostId from URLSearchParams.
 * Returns the numeric hostId or an error object.
 */
function getAndValidateHostId(
  searchParams: URLSearchParams
): number | { message: string } {
  const raw = searchParams.get('hostId')
  if (!raw || raw.trim() === '') {
    return { message: 'Missing required parameter: hostId' }
  }
  const n = Number.parseInt(raw, 10)
  if (!Number.isInteger(n) || n < 0) {
    return { message: 'hostId must be a non-negative integer' }
  }
  return n
}

export const Route = createFileRoute('/api/v1/explain')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)

        const { searchParams } = new URL(request.url)

        const validationError = validateSearchParams(searchParams)
        if (validationError) {
          return Response.json(
            {
              success: false,
              error: validationError.message,
              ...ROUTE_CONTEXT,
            },
            { status: 400 }
          )
        }

        const hostIdResult = getAndValidateHostId(searchParams)
        if (typeof hostIdResult !== 'number') {
          return Response.json(
            {
              success: false,
              error: hostIdResult.message,
              ...ROUTE_CONTEXT,
            },
            { status: 400 }
          )
        }

        return runExplain(
          hostIdResult,
          searchParams.get('query'),
          (searchParams.get('mode') || '').toUpperCase(),
          searchParams.get('planSettings') || ''
        )
      },

      POST: async ({ request }) => {
        bridgeClickHouseEnv(env as Record<string, string | undefined>)

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json(
            {
              success: false,
              error: 'Request body must be valid JSON',
              ...ROUTE_CONTEXT,
            },
            { status: 400 }
          )
        }

        if (body === null || Array.isArray(body) || typeof body !== 'object') {
          return Response.json(
            {
              success: false,
              error: 'Request body must be a JSON object',
              ...ROUTE_CONTEXT,
            },
            { status: 400 }
          )
        }

        const { hostId, query, mode, planSettings } = body as Record<
          string,
          unknown
        >

        if (hostId === undefined || hostId === null || hostId === '') {
          return Response.json(
            {
              success: false,
              error: 'Missing required parameter: hostId',
              ...ROUTE_CONTEXT,
            },
            { status: 400 }
          )
        }

        const hostIdResult = getAndValidateHostId(
          new URLSearchParams({ hostId: String(hostId) })
        )
        if (typeof hostIdResult !== 'number') {
          return Response.json(
            {
              success: false,
              error: hostIdResult.message,
              ...ROUTE_CONTEXT,
            },
            { status: 400 }
          )
        }

        return runExplain(
          hostIdResult,
          typeof query === 'string' ? query : null,
          typeof mode === 'string' ? mode.toUpperCase() : '',
          typeof planSettings === 'string' ? planSettings : ''
        )
      },
    },
  },
})
