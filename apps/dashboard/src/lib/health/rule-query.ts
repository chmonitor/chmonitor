import type { ClickHouseConfig } from '@chm/clickhouse-client'
import type { AlertRuleDef } from '@/lib/alerting/rule-registry'
import type {
  MergeProgressMode,
  MergeProgressStore,
} from './merge-progress-store'

import {
  computeMergeProgress,
  mergeStallSeconds,
  parseMergeObservations,
} from './merge-progress'
import { healthDbMergeProgressStore } from './merge-progress-store'
import { fetchData } from '@chm/clickhouse-client'
import { redactHostCredentials } from '@chm/clickhouse-client/redact-host'
import { parseAffectedNames } from '@/lib/alerting/rule-registry'

export interface RuleQueryResult {
  value: number | null
  affected: string[]
}
const UNKNOWN: RuleQueryResult = { value: null, affected: [] }

export async function runRuleQuery(
  sql: string,
  valueKey: string,
  hostId: number,
  settings?: AlertRuleDef['clickhouseSettings'],
  affectedKey?: string
): Promise<RuleQueryResult> {
  const result = await fetchData<Array<Record<string, unknown>>>({
    query: sql,
    hostId,
    format: 'JSONEachRow',
    clickhouse_settings: { ...settings, readonly: '1' },
  })
  if (result.error) throw new Error(result.error.message)
  if (!Array.isArray(result.data) || result.data.length === 0)
    return { value: 0, affected: [] }
  const affected = affectedKey
    ? parseAffectedNames(result.data[0]?.[affectedKey])
    : []
  const raw = result.data[0]?.[valueKey]
  if (raw === null || raw === undefined || raw === '')
    return { value: null, affected }
  const num = Number(raw)
  return { value: Number.isFinite(num) ? num : null, affected }
}

/** The login scopes permission-filtered merge sets; passwords and labels do not. */
export async function mergeProgressHostKey(
  config: ClickHouseConfig
): Promise<string> {
  let endpoint: string
  try {
    const url = new URL(config.host)
    endpoint = `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    endpoint = redactHostCredentials(config.host)
  }
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([endpoint, config.user ?? 'default'])
    )
  )
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
}

/** Shared dispatch: the sweep observes; GET/MCP findings only read evidence. */
export async function queryHealthRule(
  rule: AlertRuleDef,
  config: ClickHouseConfig,
  mode: MergeProgressMode,
  store: MergeProgressStore = healthDbMergeProgressStore,
  clock: () => number = Date.now
): Promise<RuleQueryResult> {
  if (!rule.sql) return UNKNOWN
  if (rule.observation !== 'merge-progress')
    return runRuleQuery(
      rule.sql,
      rule.valueKey,
      config.id,
      rule.clickhouseSettings,
      rule.affectedKey
    )
  try {
    const hostKey = await mergeProgressHostKey(config)
    // Load before querying and pin the version. A slow older query cannot
    // overwrite a newer successful sweep, even across independent processes.
    const previous = await store.load(hostKey, mode)
    if (!previous) return UNKNOWN
    const now = clock()
    if (!Number.isFinite(now) || now <= previous.updatedAtMs) return UNKNOWN
    const result = await fetchData<Array<Record<string, unknown>>>({
      query: rule.sql,
      hostId: config.id,
      format: 'JSONEachRow',
      clickhouse_settings: {
        ...rule.clickhouseSettings,
        readonly: '1',
        result_overflow_mode: 'throw',
      },
    })
    if (result.error) return UNKNOWN
    const observedEndMs = clock()
    if (!Number.isFinite(observedEndMs) || observedEndMs < now) return UNKNOWN
    const observations = parseMergeObservations(result.data)
    if (!observations) return UNKNOWN
    const beforeLimit = result.metadata?.rows_before_limit_at_least
    if (
      beforeLimit !== undefined &&
      (!Number.isFinite(Number(beforeLimit)) ||
        Number(beforeLimit) > observations.length)
    )
      return UNKNOWN
    const computed = computeMergeProgress(
      observations,
      previous,
      now,
      mergeStallSeconds(),
      observedEndMs
    )
    if (
      mode === 'observe' &&
      !(await store.save(hostKey, previous, computed.next))
    ) {
      await store.load(hostKey, 'read')
      return UNKNOWN
    }
    return {
      value: computed.value,
      affected: parseAffectedNames(computed.affected),
    }
  } catch {
    return UNKNOWN
  }
}
