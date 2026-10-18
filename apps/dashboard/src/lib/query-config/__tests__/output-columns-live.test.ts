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
import {
  classifyRejection,
  getLiveVersion,
  postToLiveServer,
} from './live-clickhouse'
import { beforeAll, describe, expect, it } from 'bun:test'
import { selectVersionedSql } from '@chm/clickhouse-client/clickhouse-version'

/**
 * Configs whose output columns MUST be verifiable live. Everything else is
 * best-effort (optional system tables, queries needing real parameters), but
 * these carry the collision pattern this guard exists for — merges and
 * detached_parts shipped it, replication-queue models the correct
 * `* EXCEPT (col)` fix — so a silent skip here would hide a regression.
 */
const MUST_VERIFY = ['merges', 'detached_parts', 'replication-queue'] as const

/**
 * Run the shipped SQL verbatim with `FORMAT JSON` and hand back the UNTOUCHED
 * server response.
 *
 * Goes over raw HTTP rather than through `fetchData` on purpose: the client
 * parses rows into objects, and duplicate keys silently collapse during JSON
 * parsing — destroying the very evidence this test looks for.
 */
function runShipped(sql: string, config: QueryConfig, analyzer: 0 | 1) {
  // Cap the result via SETTINGS rather than wrapping the query in
  // `SELECT * FROM (...)`: that wrapper's own star COLLAPSES a duplicate
  // column under the legacy analyzer, hiding the very defect being tested.
  // The shipped SQL must be sent verbatim.
  return postToLiveServer(`${sql} FORMAT JSON`, config, {
    enable_analyzer: analyzer,
    max_result_rows: 1,
    result_overflow_mode: 'break',
  })
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

  // Reachability is PROBED, never inferred. Neither CLICKHOUSE_HOST nor CI can
  // stand in for "a server exists": the workflow sets CLICKHOUSE_HOST at the
  // top level for EVERY job, and `bun` auto-loads .env locally, so both are
  // routinely set with nothing listening. Only `test-queries-config` provisions
  // a service container, and it alone sets CHM_LIVE_CLICKHOUSE — so that is the
  // signal that an unreachable server is a real failure rather than a reason to
  // skip. (Learned the hard way: an earlier `if (process.env.CI)` here failed
  // the unit-tests job, which has no ClickHouse.)
  it('has a live server whenever one is supposed to be provisioned', () => {
    if (process.env.CHM_LIVE_CLICKHOUSE) expect(liveVersion).not.toBeNull()
  })

  for (const analyzer of [1, 0] as const) {
    it(`emits no duplicate or qualified output column (enable_analyzer=${analyzer})`, async () => {
      if (!liveVersion) return // Skip - no live ClickHouse
      const offenders: string[] = []
      // #3681 (ILLEGAL_AGGREGATION) and #3851 (UNKNOWN_IDENTIFIER) both shipped
      // with this job green because a rejected query was skipped as "not
      // verifiable" (or, on 25.8, counted as verified). A rejection is now a
      // failure unless `classifyRejection` calls it an environment gap.
      const rejected: string[] = []
      const skipped: string[] = []
      const verified: string[] = []

      for (const config of Object.values(queries) as QueryConfig[]) {
        const sql = selectVersionedSql(config.sql, liveVersion)
        // ONE request per config; both the column names and the rejection are
        // read off the same response, so a healthy registry costs exactly what
        // it did before this change.
        const run = await runShipped(sql, config, analyzer)
        // 25.8 answers a rejected `FORMAT JSON` query with a 4xx/5xx AND a
        // JSON body carrying an empty `meta` plus an `exception` field, so a
        // present `meta` never means the query ran. Read the error from the
        // `exception` field, not the whole body: system.query_log rows can
        // CONTAIN the text of earlier failed queries as data.
        const exception = (run.body as { exception?: string } | null)?.exception
        if (!run.ok || exception) {
          const rejection = classifyRejection(config, exception ?? run.text)
          if (rejection.kind === 'skip') skipped.push(rejection.reason)
          else rejected.push(rejection.reason)
          continue
        }
        const names = (run.body as { meta: { name: string }[] }).meta.map(
          (column) => column.name
        )
        verified.push(config.name)
        for (const defect of defectsIn(names)) {
          offenders.push(`${config.name}: ${defect}`)
        }
      }

      console.log(
        `enable_analyzer=${analyzer}: ${verified.length} verified, ${skipped.length} skipped, ${rejected.length} rejected`
      )
      for (const reason of skipped) console.log(`  skipped ${reason}`)

      expect(offenders).toEqual([])
      expect(rejected).toEqual([])
      // A query that fails to run must not masquerade as a pass for the
      // configs that carry the pattern this guard is about.
      for (const name of MUST_VERIFY) {
        expect(verified).toContain(name)
      }
    }, 60_000)
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
      const run = await runShipped(sql, config, 1)
      expect(run.ok).toBe(true)

      const names = (
        (run.body as { meta?: { name: string }[] }).meta ?? []
      ).map((column) => column.name)
      const missing = (config.columns ?? []).filter(
        (column) => !names.includes(column)
      )
      expect({ config: name, missing }).toEqual({ config: name, missing: [] })
    }
  })
})
