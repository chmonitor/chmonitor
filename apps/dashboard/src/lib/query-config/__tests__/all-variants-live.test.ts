/**
 * `EXPLAIN` every versioned SQL variant the live server's version admits, not
 * only the one `selectVersionedSql` picks. `output-columns-live.test.ts` runs
 * one variant per config, so an older `sql[]` entry is never sent to a real
 * server and rots unseen (#3747, #3753 were version-gate bugs of this class).
 *
 * Plain `EXPLAIN` (a plan) resolves every identifier, function, and type
 * without reading data; `EXPLAIN SYNTAX` does not and passes unknown columns.
 * Self-skips without a live server, like the other live tests.
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
import {
  compareVersions,
  parseVersion,
} from '@chm/clickhouse-client/clickhouse-version'

/**
 * Old variants that are expected to fail on newer servers because ClickHouse
 * removed a column they read. The newer variant serves those servers, so the
 * old one only has to work below `removedIn`. Each entry is skipped only on
 * servers at or above `removedIn`, and the test fails if it plans there after
 * all, so an entry that is no longer needed gets removed.
 */
const REMOVED_COLUMN_VARIANTS: ReadonlyArray<{
  config: string
  since: string
  reason: string
  removedIn: string
}> = [
  {
    config: 'query-condition-cache',
    since: '25.3',
    reason: 'system.query_condition_cache dropped part_name',
    removedIn: '26.2',
  },
]

describe('every admitted versioned SQL variant against a live ClickHouse (optional)', () => {
  let liveVersion: ClickHouseVersion | null = null

  beforeAll(async () => {
    liveVersion = await getLiveVersion()
    if (!liveVersion) {
      console.log(
        '⏭️  Skipping live all-variants tests - ClickHouse not available (set CLICKHOUSE_HOST)'
      )
    }
  }, 10000)

  it('has a live server whenever one is supposed to be provisioned', () => {
    if (process.env.CHM_LIVE_CLICKHOUSE) expect(liveVersion).not.toBeNull()
  })

  it('plans every variant whose `since` is at or below the server version', async () => {
    if (!liveVersion) return // Skip - no live ClickHouse
    const server = liveVersion
    const rejected: string[] = []
    const skipped: string[] = []
    const newer: string[] = []
    const expectedFailures: string[] = []
    const unexpectedlyPlanned: string[] = []
    const matchedAllowlist = new Set<string>()
    let planned = 0

    for (const config of Object.values(queries) as QueryConfig[]) {
      if (typeof config.sql === 'string') continue
      for (const variant of config.sql) {
        const label = `${config.name}@${variant.since}`
        const allowed = REMOVED_COLUMN_VARIANTS.find(
          (entry) =>
            entry.config === config.name && entry.since === variant.since
        )
        if (allowed) matchedAllowlist.add(label)
        if (compareVersions(parseVersion(variant.since), server) > 0) {
          newer.push(label)
          continue
        }
        const removed =
          allowed !== undefined &&
          compareVersions(parseVersion(allowed.removedIn), server) <= 0
        const run = await postToLiveServer(`EXPLAIN ${variant.sql}`, config, {})
        if (removed) {
          if (run.ok) unexpectedlyPlanned.push(label)
          else expectedFailures.push(`${label} (${allowed.reason})`)
          continue
        }
        if (run.ok) {
          planned++
          continue
        }
        const rejection = classifyRejection(config, run.text)
        const reason = rejection.reason.replace(config.name, label)
        if (rejection.kind === 'skip') skipped.push(reason)
        else rejected.push(reason)
      }
    }

    console.log(
      `${planned} variants planned, ${skipped.length} skipped, ${rejected.length} rejected, ${newer.length} newer than the server`
    )
    for (const reason of skipped) console.log(`  skipped ${reason}`)
    for (const reason of expectedFailures)
      console.log(`  expected failure ${reason}`)

    expect(rejected).toEqual([])
    // An allowlisted variant that plans on a server past `removedIn` is stale.
    expect(unexpectedlyPlanned).toEqual([])
    // Every entry must still name a real variant.
    expect(
      REMOVED_COLUMN_VARIANTS.map((e) => `${e.config}@${e.since}`).filter(
        (label) => !matchedAllowlist.has(label)
      )
    ).toEqual([])
    // Guard against a vacuous pass: the registry has versioned configs.
    expect(planned).toBeGreaterThan(0)
  }, 60_000)
})
