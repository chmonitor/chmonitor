/**
 * Live output-column check for every shipped QueryConfig, against a REAL
 * ClickHouse server. Runs in CI's `test-queries-config` job (ClickHouse service
 * container, `CLICKHOUSE_HOST` set workflow-wide) and self-skips everywhere
 * else — same shape as `api/__tests__/query-cache-settings-live.test.ts`.
 *
 * Why this exists (#3029): `merges` shipped
 *
 *   SELECT *, database || '.' || table AS table FROM system.merges
 *
 * which declares `table` twice — the star already produced it. Nothing in the
 * suite caught it: `version-compatibility.test.ts` deliberately skips any
 * variant it cannot parse with confidence, and `*` is on its skip list, so the
 * broken config passed all 1157 tests. `select-star-alias-collision.test.ts`
 * guards that shape statically by regex; this file is the ground truth behind
 * it, since the server reports the real output columns.
 *
 * TWO THINGS LEARNED THE HARD WAY, both pinned by the assertions below:
 *
 * 1. `DESCRIBE (<query>)` is NOT usable here. It disambiguates the collision to
 *    `merges.table` + `table`, i.e. two DISTINCT names, so a DESCRIBE-based
 *    check passes on known-broken SQL. Only `FORMAT JSON` meta shows the defect.
 * 2. The defect looks different per analyzer, so both shapes are asserted:
 *      enable_analyzer=1 (default) → an extra `<relation>.<column>` name
 *      enable_analyzer=0 (legacy)  → the same name twice
 *
 * `FORMAT JSON` returns meta even for zero rows, so this works on an idle server
 * where `system.merges` is empty — which is exactly the state that hid the
 * original bug.
 */

import type { ClickHouseVersion } from '@chm/clickhouse-client/clickhouse-version'
import type { QueryConfig } from '../../../types/query-config'

import { queries } from '../index'
import { beforeAll, describe, expect, it } from 'bun:test'
import {
  getClickHouseVersion,
  selectVersionedSql,
} from '@chm/clickhouse-client/clickhouse-version'

const HAS_LIVE_SERVER = Boolean(process.env.CLICKHOUSE_HOST)
const HOST = process.env.CLICKHOUSE_HOST ?? ''
const USER = process.env.CLICKHOUSE_USER ?? 'default'
const PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? ''

/**
 * Configs whose output columns MUST be verifiable live. Everything else is
 * best-effort (optional system tables, queries needing real parameters), but
 * these carry the collision pattern this guard exists for — merges and
 * detached_parts shipped it, replication-queue models the correct
 * `* EXCEPT (col)` fix — so a silent skip here would hide a regression.
 */
const MUST_VERIFY = ['merges', 'detached_parts', 'replication-queue'] as const

async function getLiveVersion(): Promise<ClickHouseVersion | null> {
  if (!HAS_LIVE_SERVER) return null
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 3000)
    )
    return await Promise.race([getClickHouseVersion(0), timeout])
  } catch {
    return null
  }
}

/**
 * Output column names the server reports for `sql`, or null if it will not run
 * (optional table absent, parameters this harness cannot supply, …).
 *
 * Goes over raw HTTP rather than through `fetchData` on purpose: the client
 * parses rows into objects, and duplicate keys silently collapse during JSON
 * parsing — destroying the very evidence this test looks for. `meta` is read
 * from the untouched response.
 */
async function outputColumns(
  sql: string,
  params: Record<string, unknown>,
  analyzer: 0 | 1
): Promise<string[] | null> {
  const url = new URL(HOST)
  url.searchParams.set('user', USER)
  if (PASSWORD) url.searchParams.set('password', PASSWORD)
  url.searchParams.set('enable_analyzer', String(analyzer))
  // Cap the result via SETTINGS rather than wrapping the query in
  // `SELECT * FROM (...)`: that wrapper's own star COLLAPSES a duplicate
  // column under the legacy analyzer, hiding the very defect being tested.
  // The shipped SQL must be sent verbatim.
  url.searchParams.set('max_result_rows', '1')
  url.searchParams.set('result_overflow_mode', 'break')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(`param_${key}`, String(value))
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: `${sql} FORMAT JSON`,
    })
    if (!response.ok) return null
    const body = (await response.json()) as { meta?: { name: string }[] }
    if (!body.meta) return null
    return body.meta.map((column) => column.name)
  } catch {
    return null
  }
}

function defectsIn(names: string[]): string[] {
  const defects: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) defects.push(`duplicate column \`${name}\``)
    seen.add(name)
    // A qualified `relation.column` in the OUTPUT means the analyzer had to
    // rename a starred column around a colliding alias.
    if (/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_]/.test(name)) {
      defects.push(`qualified column \`${name}\` (star collided with an alias)`)
    }
  }
  return defects
}

describe('shipped SQL output columns against a live ClickHouse (optional)', () => {
  let liveVersion: ClickHouseVersion | null = null

  beforeAll(async () => {
    liveVersion = await getLiveVersion()
    if (!liveVersion) {
      console.log(
        '⏭️  Skipping live output-column tests - ClickHouse not available (set CLICKHOUSE_HOST)'
      )
    }
  }, 10000)

  // Reachability is PROBED, not inferred from the env var: `bun` auto-loads
  // .env, so CLICKHOUSE_HOST is routinely set on a machine with no server. But
  // in CI a server is guaranteed, so an unreachable one there is a real failure
  // rather than a reason to quietly cover nothing.
  it('has a live server whenever CI says it should', () => {
    if (process.env.CI) expect(liveVersion).not.toBeNull()
  })

  for (const analyzer of [1, 0] as const) {
    it(`emits no duplicate or qualified output column (enable_analyzer=${analyzer})`, async () => {
      if (!liveVersion) return // Skip - no live ClickHouse
      const offenders: string[] = []
      const verified: string[] = []

      for (const config of Object.values(queries) as QueryConfig[]) {
        const sql = selectVersionedSql(config.sql, liveVersion)
        const names = await outputColumns(
          sql,
          (config.defaultParams ?? {}) as Record<string, unknown>,
          analyzer
        )
        if (names === null) continue
        verified.push(config.name)
        for (const defect of defectsIn(names)) {
          offenders.push(`${config.name}: ${defect}`)
        }
      }

      expect(offenders).toEqual([])
      // A query that fails to run must not masquerade as a pass for the
      // configs that carry the pattern this guard is about.
      for (const name of MUST_VERIFY) {
        expect(verified).toContain(name)
      }
    })
  }

  it('produces every declared display column for the collision-prone configs', async () => {
    if (!liveVersion) return // Skip - no live ClickHouse
    for (const name of MUST_VERIFY) {
      const config = (Object.values(queries) as QueryConfig[]).find(
        (candidate) => candidate.name === name
      )
      expect(config).toBeDefined()
      if (!config) continue

      const sql = selectVersionedSql(config.sql, liveVersion)
      const names = await outputColumns(
        sql,
        (config.defaultParams ?? {}) as Record<string, unknown>,
        1
      )
      expect(names).not.toBeNull()

      const missing = (config.columns ?? []).filter(
        (column) => !names?.includes(column)
      )
      expect({ config: name, missing }).toEqual({ config: name, missing: [] })
    }
  })
})
