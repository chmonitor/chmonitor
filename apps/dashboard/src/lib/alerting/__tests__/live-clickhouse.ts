/**
 * Opt-in live ClickHouse for built-in alert rule tests.
 *
 * Rule SQL reads server state (metrics, queues, dictionaries) that only a real
 * server has, and the fixtures need DDL and server config (a dead cluster, a
 * low `max_concurrent_queries`). So these tests run only when
 * `CHM_ALERT_RULES_LIVE_URL` points at a scratch server, e.g.
 * `CHM_ALERT_RULES_LIVE_URL=http://default:@127.0.0.1:8123`. CI does not set
 * it, so they skip there.
 */

import { type ClickHouseClient, createClient } from '@clickhouse/client'

import type { AlertRuleDef } from '../rule-registry'

import { BUILTIN_RULES } from '../builtin-rules'

export const LIVE_URL = process.env.CHM_ALERT_RULES_LIVE_URL ?? ''

export function liveClient(): ClickHouseClient | null {
  return LIVE_URL ? createClient({ url: LIVE_URL }) : null
}

export function builtinRule(id: string): AlertRuleDef {
  const rule = BUILTIN_RULES.find((r) => r.id === id)
  if (!rule) throw new Error(`no built-in rule "${id}"`)
  return rule
}

/** Run a rule's SQL and return its value the way the sweep reads it. */
export async function ruleValue(
  client: ClickHouseClient,
  sql: string,
  valueKey: string
): Promise<number | null> {
  const rs = await client.query({ query: sql, format: 'JSONEachRow' })
  const rows = (await rs.json()) as Record<string, unknown>[]
  const raw = rows[0]?.[valueKey]
  if (raw === null || raw === undefined) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
