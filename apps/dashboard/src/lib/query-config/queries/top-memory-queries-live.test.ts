/**
 * #3920: system.processes.memory_usage is Int64 and system.query_log's is
 * UInt64. Unioned without a cast, 25.8 fails with "no supertype for types
 * UInt64, Int64" and 26.5 builds a Variant that max() rejects. Both branches
 * must emit the same signed type.
 */

import { topMemoryQueriesLiveConfig } from './top-memory-queries-live'
import { describe, expect, test } from 'bun:test'

describe('top-memory-queries-live', () => {
  test('casts memory_usage to Int64 in both UNION ALL branches', () => {
    const sql = topMemoryQueriesLiveConfig.sql as string
    const [processesBranch, queryLogBranch] = sql.split('UNION ALL')

    expect(queryLogBranch).toBeDefined()
    for (const branch of [processesBranch, queryLogBranch]) {
      expect(branch).toContain('toInt64(memory_usage) AS memory_usage')
    }
  })
})
