/**
 * POST /api/v1/slack/commands — the `/chmonitor` slash command.
 *
 * Verifies the Slack signature over the RAW body, then dispatches the
 * subcommand and responds SYNCHRONOUSLY with Block Kit blocks in the HTTP 200
 * body (Slack renders the response body when it arrives within the 3s ack
 * budget).
 *
 * Why synchronous (not the deferred `response_url` pattern): this app has no
 * `ExecutionContext.waitUntil` plumbed through (see lib/events/outbound-bus.ts),
 * so work kicked off after responding would be frozen with the isolate. We
 * therefore keep each subcommand within budget and answer inline:
 *   - status : one parallel incident snapshot (~1 CH round-trip).
 *   - query  : ONE read-only SELECT, hard-capped `max_execution_time` +
 *              `max_result_rows` so a slow/huge query fails within budget with
 *              a helpful message instead of blowing the ack.
 *   - alert  : a fast D1 read of recent alert history (no CH, no sweep — a
 *              slash command must never trigger the webhook fan-out).
 *
 * Responses are `ephemeral` (only the invoking user sees them) so query output
 * never leaks into a channel.
 *
 * Auth: the Slack signature IS the auth — this route never requires Clerk (it
 * rides the same public/`publicRead` passthrough as the github/polar webhooks).
 */

import { createFileRoute } from '@tanstack/react-router'
import type { DataFormat } from '@clickhouse/client'

import { env } from 'cloudflare:workers'
import { fetchData, getClickHouseConfigs } from '@chm/clickhouse-client'
import { error as logError } from '@chm/logger'
import { validateSqlQuery } from '@chm/sql-builder'
import { bridgeClickHouseEnv } from '@/lib/api/server-env'
import { queryAlertEvents } from '@/lib/health/alert-history-store'
import { captureIncidentSnapshot } from '@/lib/health/incident-snapshot'
import {
  buildAlertListBlocks,
  buildQueryResultBlocks,
  buildStatusBlocks,
  type SlackBlock,
} from '@/lib/slack/blocks'
import { readAndVerifySlackRequest } from '@/lib/slack/inbound'
import { parseSlashCommand } from '@/lib/slack/slash-parse'

/** Read-only query caps so `query` always answers within Slack's 3s budget. */
const QUERY_MAX_EXEC_SECONDS = 3
const QUERY_ROW_CAP = 20
/** Recent alerts shown by `/chmonitor alert`. */
const ALERT_LIST_LIMIT = 10

/** Slack ephemeral response envelope. */
function ephemeral(blocks: SlackBlock[]): Response {
  return Response.json({ response_type: 'ephemeral', blocks })
}

function hostLabelFor(hostId: number): string {
  try {
    const configs = getClickHouseConfigs()
    const cfg = configs[hostId]
    if (!cfg) return `host ${hostId}`
    return cfg.customName?.trim() || cfg.host
  } catch {
    return `host ${hostId}`
  }
}

function helpBlocks(): SlackBlock[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'chmonitor', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          'Usage:',
          '• `/chmonitor status [hostId]` — cluster health summary',
          '• `/chmonitor query <SQL>` — run a read-only SELECT (capped)',
          '• `/chmonitor alert` — recent firing alerts',
        ].join('\n'),
      },
    },
  ]
}

async function runStatus(hostId: number): Promise<SlackBlock[]> {
  const snapshot = await captureIncidentSnapshot(hostId)
  return buildStatusBlocks(hostLabelFor(hostId), snapshot)
}

async function runQuery(sql: string): Promise<SlackBlock[]> {
  if (!sql) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Provide a query, e.g. `/chmonitor query SELECT count() FROM system.tables`',
        },
      },
    ]
  }

  // SELECT-only guard (throws on DML/DDL/multi-statement) …
  try {
    validateSqlQuery(sql)
  } catch (err) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:x: ${err instanceof Error ? err.message : 'Only read-only SELECT queries are allowed.'}`,
        },
      },
    ]
  }

  // … plus hard read-only + row/time caps as defense-in-depth and to keep the
  // response within Slack's 3s budget. `result_overflow_mode: 'break'` stops at
  // the row cap WITHOUT erroring (unlike the default 'throw').
  //
  // `readonly: 2` (NOT 1): level 1 forbids write queries AND changing any other
  // setting in the same request, so pairing it with the caps below would throw
  // "Cannot modify 'max_execution_time' setting in readonly mode". Level 2 still
  // blocks writes (SELECT/SHOW only) but permits per-query settings — exactly
  // what we need. `validateSqlQuery` already enforced SELECT-only above, so this
  // is belt-and-suspenders. Typed as a widened record (matching explorer/query.ts)
  // since the per-key ClickHouse setting types want string values here.
  const clickhouse_settings: Record<string, string | number> = {
    readonly: 2,
    max_execution_time: QUERY_MAX_EXEC_SECONDS,
    max_result_rows: QUERY_ROW_CAP + 1,
    result_overflow_mode: 'break',
  }

  const result = await fetchData<Array<Record<string, unknown>>>({
    query: sql,
    hostId: 0,
    format: 'JSONEachRow' as DataFormat,
    clickhouse_settings,
  })

  if (result.error) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:x: Query failed: ${result.error.message}`,
        },
      },
    ]
  }

  const rows = result.data ?? []
  const truncated = rows.length > QUERY_ROW_CAP
  return buildQueryResultBlocks(sql, rows, {
    rowCap: QUERY_ROW_CAP,
    durationMs: Number(result.metadata.duration ?? 0) || undefined,
    truncated,
  })
}

async function runAlert(): Promise<SlackBlock[]> {
  const events = await queryAlertEvents({ limit: ALERT_LIST_LIMIT * 2 })
  // "Firing" = the most recent non-recovery events.
  const firing = events
    .filter((e) => e.severity !== 'recovery')
    .slice(0, ALERT_LIST_LIMIT)
  return buildAlertListBlocks(firing)
}

async function handlePost(request: Request): Promise<Response> {
  const { configured, verified, rawBody } =
    await readAndVerifySlackRequest(request)
  if (!configured) {
    return Response.json({ error: 'Slack app not configured' }, { status: 501 })
  }
  if (!verified) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // CH-querying subcommands need CLICKHOUSE_* on process.env (workerd binding).
  bridgeClickHouseEnv(env as Record<string, string | undefined>)

  const params = new URLSearchParams(rawBody)
  const { sub, arg, hostId } = parseSlashCommand(params.get('text') ?? '')

  try {
    switch (sub) {
      case 'status':
        return ephemeral(await runStatus(hostId))
      case 'query':
        return ephemeral(await runQuery(arg))
      case 'alert':
        return ephemeral(await runAlert())
      default:
        return ephemeral(helpBlocks())
    }
  } catch (err) {
    logError('[slack-commands] handler error', err)
    return ephemeral([
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':x: Something went wrong handling that command. Please try again.',
        },
      },
    ])
  }
}

export const Route = createFileRoute('/api/v1/slack/commands')({
  server: {
    handlers: {
      POST: async ({ request }) => handlePost(request),
    },
  },
})

// Exported for unit tests only.
export { handlePost as __handlePostForTests }
