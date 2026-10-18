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
    let planned = 0

    for (const config of Object.values(queries) as QueryConfig[]) {
      if (typeof config.sql === 'string') continue
      for (const variant of config.sql) {
        const label = `${config.name}@${variant.since}`
        if (compareVersions(parseVersion(variant.since), server) > 0) {
          newer.push(label)
          continue
        }
        const run = await postToLiveServer(`EXPLAIN ${variant.sql}`, config, {})
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

    expect(rejected).toEqual([])
    // Guard against a vacuous pass: the registry has versioned configs.
    expect(planned).toBeGreaterThan(0)
  }, 60_000)
})
