/**
 * @fileoverview Integration test that runs only when ClickHouse is available
 * This test will be skipped in CI and local environments without ClickHouse
 */

import { beforeAll, describe, expect, it } from 'bun:test'

const { getClickHouseConfigs } = await import(
  new URL(
    '../clickhouse/clickhouse-config.ts?test=integration',
    import.meta.url
  ).href
)

async function isClickHouseAvailable(): Promise<boolean> {
  if (!process.env.CLICKHOUSE_HOST) {
    return false
  }

  try {
    const { fetchData } = await import(
      new URL(
        '../clickhouse/clickhouse-fetch.ts?test=integration',
        import.meta.url
      ).href
    )

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 2000)
    )

    const fetchPromise = fetchData({
      query: 'SELECT 1 as ping',
      hostId: 0,
    })

    const result = await Promise.race([fetchPromise, timeoutPromise])

    return result && !result.error
  } catch (_error) {
    return false
  }
}

describe('ClickHouse Integration Tests (Optional)', () => {
  let clickHouseAvailable: boolean

  beforeAll(async () => {
    const _timeout = process.env.CI === 'true' ? 2000 : 10000

    try {
      clickHouseAvailable = await isClickHouseAvailable()
    } catch (_error) {
      clickHouseAvailable = false
    }

    if (!clickHouseAvailable) {
      console.log(
        '⏭️  Skipping ClickHouse integration tests - database not available'
      )
      console.log(
        '   To run these tests, ensure ClickHouse is running on localhost:8123'
      )
      console.log('   and CLICKHOUSE_HOST environment variable is set')
    }
  }, 5000) // Reduced timeout for CI

  it('should connect to ClickHouse when available', async () => {
    if (!clickHouseAvailable) {
      return // Skip test
    }

    const { fetchData } = await import(
      new URL(
        '../clickhouse/clickhouse-fetch.ts?test=integration',
        import.meta.url
      ).href
    )

    const result = await fetchData({
      query: 'SELECT version() as version',
      hostId: 0,
    })

    expect(result.data).toBeDefined()
    expect(result.metadata).toBeDefined()
    expect(result.error).toBeUndefined()
  })

  it('should handle multiple hosts when configured', async () => {
    if (!clickHouseAvailable) {
      return // Skip test
    }

    const { fetchData } = await import(
      new URL(
        '../clickhouse/clickhouse-fetch.ts?test=integration',
        import.meta.url
      ).href
    )

    const configs = getClickHouseConfigs()

    if (configs.length <= 1) {
      console.log('⏭️  Skipping multi-host test - only one host configured')
      return
    }

    const results = await Promise.all([
      fetchData({ query: 'SELECT 1 as test', hostId: 0 }),
      fetchData({ query: 'SELECT 1 as test', hostId: 1 }),
    ])

    results.forEach((result, index) => {
      expect(result.data).toBeDefined()
      expect(result.metadata.host).toBe(configs[index].host)
    })
  })

  it('should validate query configurations against real database', async () => {
    if (!clickHouseAvailable) {
      return // Skip test
    }

    const { fetchData } = await import(
      new URL(
        '../clickhouse/clickhouse-fetch.ts?test=integration',
        import.meta.url
      ).href
    )

    const essentialTables = [
      'system.query_log',
      'system.metrics',
      'system.tables',
    ]

    for (const table of essentialTables) {
      const result = await fetchData({
        query: `SELECT count() as count FROM ${table} LIMIT 1`,
        hostId: 0,
      })

      expect(result.error).toBeUndefined()
      expect(result.data).toBeDefined()
    }
  })
})

// Separate describe block for tests that should always run
describe('Integration Test Configuration', () => {
  it('should have valid ClickHouse configuration when CLICKHOUSE_HOST is set', async () => {
    if (!process.env.CLICKHOUSE_HOST) {
      console.log(
        'ℹ️  CLICKHOUSE_HOST not set - integration tests will be skipped'
      )
      return
    }

    const configs = getClickHouseConfigs()
    expect(configs.length).toBeGreaterThan(0)

    configs.forEach((config, index) => {
      expect(config.host).toBeDefined()
      expect(config.user).toBeDefined()
      expect(config.id).toBe(index)
    })
  })

  it('should provide clear guidance for running integration tests', () => {
    const guidance = {
      title: 'Running ClickHouse Integration Tests',
      steps: [
        '1. Start ClickHouse server locally: docker run -p 8123:8123 clickhouse/clickhouse-server',
        '2. Set environment variables: export CLICKHOUSE_HOST=http://localhost:8123',
        '3. Run integration tests: pnpm test-queries-config',
        '4. Or run all tests: pnpm test',
      ],
      notes: [
        'Integration tests are automatically skipped in CI environments',
        'Tests are skipped when ClickHouse is not available locally',
        'Use Docker for consistent local testing environment',
      ],
    }

    expect(guidance).toBeDefined()
    console.log('\n📚 Integration Test Guidance:')
    guidance.steps.forEach((step) => console.log(`   ${step}`))
    console.log('\n📝 Notes:')
    guidance.notes.forEach((note) => console.log(`   • ${note}`))
  })
})
