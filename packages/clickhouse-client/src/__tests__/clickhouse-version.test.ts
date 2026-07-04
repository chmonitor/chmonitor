import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'

// Mock the leaf ClickHouse client packages (same approach as
// clickhouse-fetch.test.ts) so getClient() resolves to a controllable
// fake client instead of making a real network call.
const mockClientQuery = mock(() =>
  Promise.resolve({ json: () => Promise.resolve([{ exists: 0 }]) })
)
const mockClient = { query: mockClientQuery }
const mockCreateClient = mock(() => mockClient)

mock.module('@clickhouse/client', () => ({
  createClient: mockCreateClient,
}))
mock.module('@clickhouse/client-web', () => ({
  createClient: mockCreateClient,
}))

afterAll(() => {
  mock.restore()
})

const {
  parseVersion,
  compareVersions,
  meetsMinVersion,
  versionMatchesRange,
  parseSemverRange,
  matchesSemverRange,
  selectVersionedSql,
  getTableInfoMessage,
  SYSTEM_TABLE_INFO,
  checkTableExists,
  getClickHouseVersion,
  setVersionCacheL2Provider,
  clearVersionCache,
} = await import(
  new URL('../clickhouse-version.ts?test=version', import.meta.url).href
)

const { _resetEnvCache: resetEnvCache } = await import(
  '../clickhouse/env-schema'
)
const { clientPool } = await import('../clickhouse/connection-pool')

describe('parseVersion', () => {
  it('parses a standard 3-part version', () => {
    const v = parseVersion('24.3.1')
    expect(v).toEqual({
      major: 24,
      minor: 3,
      patch: 1,
      build: undefined,
      raw: '24.3.1',
    })
  })

  it('parses a 4-part version with build number', () => {
    const v = parseVersion('24.3.1.1')
    expect(v).toEqual({
      major: 24,
      minor: 3,
      patch: 1,
      build: 1,
      raw: '24.3.1.1',
    })
  })

  it('handles a single number (major only)', () => {
    const v = parseVersion('24')
    expect(v.major).toBe(24)
    expect(v.minor).toBe(0)
    expect(v.patch).toBe(0)
  })

  it('handles two-part version', () => {
    const v = parseVersion('24.3')
    expect(v.major).toBe(24)
    expect(v.minor).toBe(3)
    expect(v.patch).toBe(0)
  })

  it('handles empty string gracefully', () => {
    const v = parseVersion('')
    expect(v.major).toBe(0)
    expect(v.minor).toBe(0)
    expect(v.patch).toBe(0)
    expect(v.raw).toBe('')
  })
})

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    const a = parseVersion('24.3.1')
    const b = parseVersion('24.3.1')
    expect(compareVersions(a, b)).toBe(0)
  })

  it('returns positive when a > b (major)', () => {
    const a = parseVersion('25.1.0')
    const b = parseVersion('24.3.1')
    expect(compareVersions(a, b)).toBeGreaterThan(0)
  })

  it('returns negative when a < b (major)', () => {
    const a = parseVersion('23.8.1')
    const b = parseVersion('24.3.1')
    expect(compareVersions(a, b)).toBeLessThan(0)
  })

  it('compares minor when major is equal', () => {
    const a = parseVersion('24.5.0')
    const b = parseVersion('24.3.0')
    expect(compareVersions(a, b)).toBeGreaterThan(0)
  })

  it('compares patch when major and minor are equal', () => {
    const a = parseVersion('24.3.2')
    const b = parseVersion('24.3.1')
    expect(compareVersions(a, b)).toBeGreaterThan(0)
  })

  it('ignores build number in comparison', () => {
    const a = parseVersion('24.3.1.5')
    const b = parseVersion('24.3.1.1')
    // build is not compared, returns 0
    expect(compareVersions(a, b)).toBe(0)
  })
})

describe('meetsMinVersion', () => {
  it('returns true when version meets minimum', () => {
    const v = parseVersion('24.5.1')
    expect(meetsMinVersion(v, 24)).toBe(true)
  })

  it('returns false when version is below minimum', () => {
    const v = parseVersion('23.8.1')
    expect(meetsMinVersion(v, 24)).toBe(false)
  })

  it('checks minor version', () => {
    const v = parseVersion('24.3.1')
    expect(meetsMinVersion(v, 24, 5)).toBe(false)
    expect(meetsMinVersion(v, 24, 3)).toBe(true)
    expect(meetsMinVersion(v, 24, 1)).toBe(true)
  })

  it('checks patch version', () => {
    const v = parseVersion('24.3.1')
    expect(meetsMinVersion(v, 24, 3, 2)).toBe(false)
    expect(meetsMinVersion(v, 24, 3, 1)).toBe(true)
  })
})

describe('parseSemverRange', () => {
  it('parses >= prefix', () => {
    const bounds = parseSemverRange('>=24.1')
    expect(bounds.min).toEqual(expect.objectContaining({ major: 24, minor: 1 }))
    expect(bounds.minInclusive).toBe(true)
  })

  it('parses > prefix (exclusive)', () => {
    const bounds = parseSemverRange('>24.1')
    expect(bounds.min).toEqual(expect.objectContaining({ major: 24, minor: 1 }))
    expect(bounds.minInclusive).toBe(false)
  })

  it('parses <= prefix', () => {
    const bounds = parseSemverRange('<=24.5')
    expect(bounds.max).toEqual(expect.objectContaining({ major: 24, minor: 5 }))
    expect(bounds.maxInclusive).toBe(true)
  })

  it('parses < prefix (exclusive)', () => {
    const bounds = parseSemverRange('<24.5')
    expect(bounds.max).toEqual(expect.objectContaining({ major: 24, minor: 5 }))
    expect(bounds.maxInclusive).toBe(false)
  })

  it('parses compound range ">=24.1 <24.5"', () => {
    const bounds = parseSemverRange('>=24.1 <24.5')
    expect(bounds.min).toEqual(expect.objectContaining({ major: 24, minor: 1 }))
    expect(bounds.minInclusive).toBe(true)
    expect(bounds.max).toEqual(expect.objectContaining({ major: 24, minor: 5 }))
    expect(bounds.maxInclusive).toBe(false)
  })

  it('parses caret range ^24.1.2', () => {
    const bounds = parseSemverRange('^24.1.2')
    expect(bounds.min).toEqual(
      expect.objectContaining({ major: 24, minor: 1, patch: 2 })
    )
    expect(bounds.minInclusive).toBe(true)
    expect(bounds.max).toEqual(
      expect.objectContaining({ major: 25, minor: 0, patch: 0 })
    )
    expect(bounds.maxInclusive).toBe(false)
  })

  it('parses tilde range ~24.1.2', () => {
    const bounds = parseSemverRange('~24.1.2')
    expect(bounds.min).toEqual(
      expect.objectContaining({ major: 24, minor: 1, patch: 2 })
    )
    expect(bounds.minInclusive).toBe(true)
    expect(bounds.max).toEqual(
      expect.objectContaining({ major: 24, minor: 2, patch: 0 })
    )
    expect(bounds.maxInclusive).toBe(false)
  })

  it('parses plain version as caret-like range', () => {
    const bounds = parseSemverRange('24.1')
    expect(bounds.min).toEqual(expect.objectContaining({ major: 24, minor: 1 }))
    expect(bounds.minInclusive).toBe(true)
    expect(bounds.max).toEqual(
      expect.objectContaining({ major: 25, minor: 0, patch: 0 })
    )
    expect(bounds.maxInclusive).toBe(false)
  })

  it('parses =version', () => {
    const bounds = parseSemverRange('=24.3')
    expect(bounds.min).toEqual(expect.objectContaining({ major: 24, minor: 3 }))
    expect(bounds.minInclusive).toBe(true)
    expect(bounds.max).toEqual(expect.objectContaining({ major: 25 }))
  })

  it('returns default bounds for empty string', () => {
    const bounds = parseSemverRange('')
    expect(bounds.min).toBeUndefined()
    expect(bounds.max).toBeUndefined()
    expect(bounds.minInclusive).toBe(true)
    expect(bounds.maxInclusive).toBe(true)
  })

  it('returns default bounds for whitespace', () => {
    const bounds = parseSemverRange('   ')
    expect(bounds.min).toBeUndefined()
    expect(bounds.max).toBeUndefined()
  })
})

describe('matchesSemverRange', () => {
  it('matches >=24.1 for version 24.3.1', () => {
    const v = parseVersion('24.3.1')
    expect(matchesSemverRange(v, '>=24.1')).toBe(true)
  })

  it('does not match >=24.5 for version 24.3.1', () => {
    const v = parseVersion('24.3.1')
    expect(matchesSemverRange(v, '>=24.5')).toBe(false)
  })

  it('matches range >=24.1 <24.5 for 24.3.1', () => {
    const v = parseVersion('24.3.1')
    expect(matchesSemverRange(v, '>=24.1 <24.5')).toBe(true)
  })

  it('does not match range >=24.1 <24.2 for 24.3.1', () => {
    const v = parseVersion('24.3.1')
    expect(matchesSemverRange(v, '>=24.1 <24.2')).toBe(false)
  })

  it('matches ^24.1 for 24.3.1', () => {
    const v = parseVersion('24.3.1')
    expect(matchesSemverRange(v, '^24.1')).toBe(true)
  })

  it('does not match ^24.1 for 25.0.0', () => {
    const v = parseVersion('25.0.0')
    expect(matchesSemverRange(v, '^24.1')).toBe(false)
  })

  it('matches ~24.3.1 for 24.3.5', () => {
    const v = parseVersion('24.3.5')
    expect(matchesSemverRange(v, '~24.3.1')).toBe(true)
  })

  it('does not match ~24.3.1 for 24.4.0', () => {
    const v = parseVersion('24.4.0')
    expect(matchesSemverRange(v, '~24.3.1')).toBe(false)
  })

  it('matches >24.1 (exclusive) for 24.2.0', () => {
    const v = parseVersion('24.2.0')
    expect(matchesSemverRange(v, '>24.1')).toBe(true)
  })

  it('does not match >24.1 (exclusive) for 24.1.0', () => {
    const v = parseVersion('24.1.0')
    expect(matchesSemverRange(v, '>24.1')).toBe(false)
  })

  it('matches <=24.3 for 24.3.0', () => {
    const v = parseVersion('24.3.0')
    expect(matchesSemverRange(v, '<=24.3')).toBe(true)
  })

  it('matches plain version 24.1 for 24.3.5', () => {
    const v = parseVersion('24.3.5')
    expect(matchesSemverRange(v, '24.1')).toBe(true) // >=24.1 <25.0
  })
})

describe('selectVersionedSql', () => {
  it('returns string as-is', () => {
    expect(selectVersionedSql('SELECT 1', null)).toBe('SELECT 1')
  })

  it('throws on empty array', () => {
    expect(() => selectVersionedSql([], parseVersion('24.1'))).toThrow(
      'VersionedSql array cannot be empty'
    )
  })

  it('returns first (oldest) entry when no version', () => {
    const sql = [
      { since: '23.8', sql: 'OLD' },
      { since: '24.1', sql: 'NEW' },
    ]
    expect(selectVersionedSql(sql, null)).toBe('OLD')
  })

  it('selects the highest since <= current version', () => {
    const sql = [
      { since: '23.8', sql: 'V23_8' },
      { since: '24.1', sql: 'V24_1' },
      { since: '24.5', sql: 'V24_5' },
    ]
    const v = parseVersion('24.3.1')
    expect(selectVersionedSql(sql, v)).toBe('V24_1')
  })

  it('selects exact match version', () => {
    const sql = [
      { since: '23.8', sql: 'V23_8' },
      { since: '24.1', sql: 'V24_1' },
    ]
    const v = parseVersion('24.1.0')
    expect(selectVersionedSql(sql, v)).toBe('V24_1')
  })

  it('selects newest entry for very new version', () => {
    const sql = [
      { since: '23.8', sql: 'V23_8' },
      { since: '24.1', sql: 'V24_1' },
    ]
    const v = parseVersion('25.0.0')
    expect(selectVersionedSql(sql, v)).toBe('V24_1')
  })

  it('falls back to oldest when version is older than all entries', () => {
    const sql = [
      { since: '23.8', sql: 'V23_8' },
      { since: '24.1', sql: 'V24_1' },
    ]
    const v = parseVersion('22.1.0')
    expect(selectVersionedSql(sql, v)).toBe('V23_8')
  })

  it('handles unsorted input array', () => {
    const sql = [
      { since: '24.5', sql: 'V24_5' },
      { since: '23.8', sql: 'V23_8' },
      { since: '24.1', sql: 'V24_1' },
    ]
    const v = parseVersion('24.3.0')
    expect(selectVersionedSql(sql, v)).toBe('V24_1')
  })
})

describe('versionMatchesRange', () => {
  it('matches when within range', () => {
    const v = parseVersion('24.3.1')
    expect(versionMatchesRange(v, '24.1', '24.5')).toBe(true)
  })

  it('does not match when below min', () => {
    const v = parseVersion('23.8.1')
    expect(versionMatchesRange(v, '24.1', undefined)).toBe(false)
  })

  it('does not match when at or above max (exclusive)', () => {
    const v = parseVersion('24.5.0')
    expect(versionMatchesRange(v, undefined, '24.5')).toBe(false)
  })

  it('matches when only min specified', () => {
    const v = parseVersion('25.0.0')
    expect(versionMatchesRange(v, '24.1', undefined)).toBe(true)
  })

  it('matches when only max specified', () => {
    const v = parseVersion('23.8.1')
    expect(versionMatchesRange(v, undefined, '24.1')).toBe(true)
  })

  it('matches when no bounds specified', () => {
    const v = parseVersion('24.3.1')
    expect(versionMatchesRange(v, undefined, undefined)).toBe(true)
  })
})

describe('SYSTEM_TABLE_INFO', () => {
  it('contains info for system.metric_log', () => {
    expect(SYSTEM_TABLE_INFO['system.metric_log']).toBeDefined()
    expect(SYSTEM_TABLE_INFO['system.metric_log'].requiresConfig).toBe(true)
  })

  it('contains info for system.zookeeper', () => {
    expect(SYSTEM_TABLE_INFO['system.zookeeper']).toBeDefined()
    expect(SYSTEM_TABLE_INFO['system.zookeeper'].description).toContain(
      'ZooKeeper'
    )
  })

  it('contains info for system.backup_log', () => {
    expect(SYSTEM_TABLE_INFO['system.backup_log']).toBeDefined()
    expect(SYSTEM_TABLE_INFO['system.backup_log'].minVersion?.major).toBe(22)
  })
})

describe('getTableInfoMessage', () => {
  it('returns description for known tables', () => {
    const msg = getTableInfoMessage('system.metric_log')
    expect(msg).toContain('metric_log')
  })

  it('returns generic message for unknown tables', () => {
    const msg = getTableInfoMessage('system.unknown_table')
    expect(msg).toContain('may require specific configuration')
  })
})

describe('checkTableExists', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123'
    process.env.CLICKHOUSE_USER = 'default'
    process.env.CLICKHOUSE_PASSWORD = ''
    resetEnvCache()
    clientPool.clear()
    mockCreateClient.mockReset()
    mockClientQuery.mockReset()
    mockCreateClient.mockReturnValue(mockClient)
    mockClientQuery.mockResolvedValue({
      json: () => Promise.resolve([{ exists: 0 }]),
    })
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('sends a parameterized query using query_params instead of interpolating db/table into the SQL', async () => {
    await checkTableExists(0, 'system', 'backup_log')

    expect(mockClientQuery).toHaveBeenCalledTimes(1)
    const call = mockClientQuery.mock.calls[0][0]

    // The SQL must use bound placeholders, not raw interpolated values.
    expect(call.query).toContain('{database:String}')
    expect(call.query).toContain('{table:String}')
    expect(call.query).not.toContain("'system'")
    expect(call.query).not.toContain("'backup_log'")

    // The actual values must be passed via query_params.
    expect(call.query_params).toEqual({
      database: 'system',
      table: 'backup_log',
    })
  })

  it('returns true when the query reports the table exists', async () => {
    mockClientQuery.mockResolvedValue({
      json: () => Promise.resolve([{ exists: 1 }]),
    })

    const result = await checkTableExists(0, 'system', 'query_log')
    expect(result).toBe(true)
  })

  it('returns false when the query reports the table does not exist', async () => {
    mockClientQuery.mockResolvedValue({
      json: () => Promise.resolve([{ exists: 0 }]),
    })

    const result = await checkTableExists(0, 'system', 'missing_table')
    expect(result).toBe(false)
  })

  it('returns false when the underlying client query throws', async () => {
    mockClientQuery.mockRejectedValue(new Error('connection refused'))

    const result = await checkTableExists(0, 'system', 'query_log')
    expect(result).toBe(false)
  })
})

describe('getClickHouseVersion — L2 (KV) cache wiring (issue #2183)', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123'
    process.env.CLICKHOUSE_USER = 'default'
    process.env.CLICKHOUSE_PASSWORD = ''
    resetEnvCache()
    clientPool.clear()
    clearVersionCache()
    setVersionCacheL2Provider(null)
    mockCreateClient.mockReset()
    mockClientQuery.mockReset()
    mockCreateClient.mockReturnValue(mockClient)
    mockClientQuery.mockResolvedValue({
      json: () => Promise.resolve([{ version: '24.3.1.1' }]),
    })
  })

  afterAll(() => {
    process.env = originalEnv
    setVersionCacheL2Provider(null)
  })

  it('returns the L2 cache hit without querying ClickHouse', async () => {
    const cached = parseVersion('23.8.0')
    setVersionCacheL2Provider(() => ({
      get: async () => cached,
      set: async () => {},
    }))

    const result = await getClickHouseVersion(0)

    expect(result).toEqual(cached)
    expect(mockClientQuery).not.toHaveBeenCalled()
  })

  it('queries ClickHouse and populates the L2 cache on an L2 miss', async () => {
    const setSpy = mock(async () => {})
    setVersionCacheL2Provider(() => ({
      get: async () => null,
      set: setSpy,
    }))

    const result = await getClickHouseVersion(0)

    expect(result).toEqual(parseVersion('24.3.1.1'))
    expect(mockClientQuery).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledTimes(1)
    const [hostId, version, ttlSeconds] = setSpy.mock.calls[0]
    expect(hostId).toBe(0)
    expect(version).toEqual(parseVersion('24.3.1.1'))
    expect(ttlSeconds).toBe(24 * 60 * 60) // 24h, matching the L1 TTL
  })

  it('degrades to L1-memory-only when no L2 provider is registered (Node/self-hosted path)', async () => {
    // No `setVersionCacheL2Provider` call — mirrors the Node/self-hosted
    // build, where `src/start.ts` never wires a provider because
    // `target().kv(...)` (or the resolved binding) is null.
    const first = await getClickHouseVersion(0)
    expect(first).toEqual(parseVersion('24.3.1.1'))
    expect(mockClientQuery).toHaveBeenCalledTimes(1)

    // Second call within the TTL window hits the L1 map, not ClickHouse again.
    const second = await getClickHouseVersion(0)
    expect(second).toEqual(parseVersion('24.3.1.1'))
    expect(mockClientQuery).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the L2 provider rejects', async () => {
    setVersionCacheL2Provider(() => ({
      get: async () => {
        throw new Error('KV unavailable')
      },
      set: async () => {
        throw new Error('KV unavailable')
      },
    }))

    const result = await getClickHouseVersion(0)
    expect(result).toEqual(parseVersion('24.3.1.1'))
    expect(mockClientQuery).toHaveBeenCalledTimes(1)
  })
})
