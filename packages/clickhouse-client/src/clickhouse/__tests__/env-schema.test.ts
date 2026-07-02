import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'

// Mock logger so tests don't pollute stdout
mock.module('@chm/logger', () => ({
  debug: mock(() => {}),
  error: mock(() => {}),
  warn: mock(() => {}),
  isDebugEnabled: mock(() => false),
}))

const { clickhouseEnvSchema, validateClickHouseEnv, _resetEnvCache } =
  await import(
    new URL('../env-schema.ts?test=env-schema', import.meta.url).href
  )

describe('clickhouseEnvSchema', () => {
  it('accepts a valid CLICKHOUSE_HOST', () => {
    const result = clickhouseEnvSchema.safeParse({
      CLICKHOUSE_HOST: 'http://localhost:8123',
    })
    expect(result.success).toBe(true)
  })

  it('requires CLICKHOUSE_HOST to be non-empty', () => {
    const result = clickhouseEnvSchema.safeParse({
      CLICKHOUSE_HOST: '',
    })
    expect(result.success).toBe(false)
  })

  it('defaults CLICKHOUSE_USER to "default"', () => {
    const result = clickhouseEnvSchema.safeParse({
      CLICKHOUSE_HOST: 'http://localhost:8123',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.CLICKHOUSE_USER).toBe('default')
    }
  })

  it('defaults CLICKHOUSE_PASSWORD to empty string', () => {
    const result = clickhouseEnvSchema.safeParse({
      CLICKHOUSE_HOST: 'http://localhost:8123',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.CLICKHOUSE_PASSWORD).toBe('')
    }
  })

  it('defaults CLICKHOUSE_MAX_EXECUTION_TIME to 60', () => {
    const result = clickhouseEnvSchema.safeParse({
      CLICKHOUSE_HOST: 'http://localhost:8123',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.CLICKHOUSE_MAX_EXECUTION_TIME).toBe(60)
    }
  })

  it('coerces CLICKHOUSE_MAX_EXECUTION_TIME from string to number', () => {
    const result = clickhouseEnvSchema.safeParse({
      CLICKHOUSE_HOST: 'http://localhost:8123',
      CLICKHOUSE_MAX_EXECUTION_TIME: '120',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.CLICKHOUSE_MAX_EXECUTION_TIME).toBe(120)
    }
  })

  it('rejects non-positive CLICKHOUSE_MAX_EXECUTION_TIME', () => {
    const result = clickhouseEnvSchema.safeParse({
      CLICKHOUSE_HOST: 'http://localhost:8123',
      CLICKHOUSE_MAX_EXECUTION_TIME: -5,
    })
    expect(result.success).toBe(false)
  })

  it('rejects zero CLICKHOUSE_MAX_EXECUTION_TIME', () => {
    const result = clickhouseEnvSchema.safeParse({
      CLICKHOUSE_HOST: 'http://localhost:8123',
      CLICKHOUSE_MAX_EXECUTION_TIME: 0,
    })
    expect(result.success).toBe(false)
  })

  it('accepts custom CLICKHOUSE_NAME', () => {
    const result = clickhouseEnvSchema.safeParse({
      CLICKHOUSE_HOST: 'http://localhost:8123',
      CLICKHOUSE_NAME: 'prod,staging',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.CLICKHOUSE_NAME).toBe('prod,staging')
    }
  })

  it('accepts all fields together', () => {
    const result = clickhouseEnvSchema.safeParse({
      CLICKHOUSE_HOST: 'http://host1,http://host2',
      CLICKHOUSE_USER: 'admin,default',
      CLICKHOUSE_PASSWORD: 'secret,',
      CLICKHOUSE_NAME: 'prod,staging',
      CLICKHOUSE_MAX_EXECUTION_TIME: '30',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.CLICKHOUSE_HOST).toBe('http://host1,http://host2')
      expect(result.data.CLICKHOUSE_USER).toBe('admin,default')
      expect(result.data.CLICKHOUSE_PASSWORD).toBe('secret,')
      expect(result.data.CLICKHOUSE_NAME).toBe('prod,staging')
      expect(result.data.CLICKHOUSE_MAX_EXECUTION_TIME).toBe(30)
    }
  })
})

describe('validateClickHouseEnv', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env = { ...originalEnv }
    _resetEnvCache()
  })

  afterAll(() => {
    process.env = originalEnv
    mock.restore()
  })

  it('returns fallback when CLICKHOUSE_HOST is missing', () => {
    delete process.env.CLICKHOUSE_HOST
    const result = validateClickHouseEnv()
    expect(result.CLICKHOUSE_HOST).toBe('')
    expect(result.CLICKHOUSE_USER).toBe('default')
    expect(result.CLICKHOUSE_PASSWORD).toBe('')
    expect(result.CLICKHOUSE_MAX_EXECUTION_TIME).toBe(60)
  })

  it('parses valid env vars', () => {
    process.env.CLICKHOUSE_HOST = 'http://localhost:8123'
    process.env.CLICKHOUSE_USER = 'admin'
    process.env.CLICKHOUSE_PASSWORD = 'secret'
    process.env.CLICKHOUSE_MAX_EXECUTION_TIME = '90'

    const result = validateClickHouseEnv()
    expect(result.CLICKHOUSE_HOST).toBe('http://localhost:8123')
    expect(result.CLICKHOUSE_USER).toBe('admin')
    expect(result.CLICKHOUSE_PASSWORD).toBe('secret')
    expect(result.CLICKHOUSE_MAX_EXECUTION_TIME).toBe(90)
  })

  it('caches result on first call', () => {
    process.env.CLICKHOUSE_HOST = 'http://host1'

    const first = validateClickHouseEnv()
    // Change env after first call — cache should still return old value
    process.env.CLICKHOUSE_HOST = 'http://host2'

    const second = validateClickHouseEnv()
    expect(first).toBe(second)
    expect(second.CLICKHOUSE_HOST).toBe('http://host1')
  })

  it('resets cache with _resetEnvCache', () => {
    process.env.CLICKHOUSE_HOST = 'http://host1'
    validateClickHouseEnv()

    process.env.CLICKHOUSE_HOST = 'http://host2'
    _resetEnvCache()

    const result = validateClickHouseEnv()
    expect(result.CLICKHOUSE_HOST).toBe('http://host2')
  })
})
