/**
 * Resolution-order tests for the server-side dashboard store resolver:
 * D1 binding → ClickHouse state env → Postgres env → D1 fallback.
 * `@chm/platform` is mocked (bun test runs outside Cloudflare).
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

let d1Binding: unknown

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({ getD1Database: () => d1Binding }),
}))

const { resolveDashboardStore } = await import('./resolve-server-store')
const { D1DashboardStore } = await import('./d1-store')
const { ClickHouseDashboardStore } = await import('./clickhouse-store')
const { PostgresDashboardStore } = await import('./postgres-store')

const STATE_ENV_KEYS = [
  'CHM_STATE_CLICKHOUSE_URL',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
] as const

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  d1Binding = undefined
  savedEnv = {}
  for (const key of STATE_ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of STATE_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('resolveDashboardStore', () => {
  test('D1 binding wins over everything (cloud behavior unchanged)', async () => {
    d1Binding = {}
    process.env.CHM_STATE_CLICKHOUSE_URL = 'http://ch:8123'
    process.env.DATABASE_URL = 'postgres://a'
    expect(await resolveDashboardStore()).toBeInstanceOf(D1DashboardStore)
  })

  test('ClickHouse state env wins over Postgres env', async () => {
    process.env.CHM_STATE_CLICKHOUSE_URL = 'http://ch:8123'
    process.env.DATABASE_URL = 'postgres://a'
    expect(await resolveDashboardStore()).toBeInstanceOf(
      ClickHouseDashboardStore
    )
  })

  test('Postgres env resolves when no D1 and no ClickHouse state env', async () => {
    process.env.DATABASE_URL = 'postgres://a'
    expect(await resolveDashboardStore()).toBeInstanceOf(PostgresDashboardStore)
  })

  test('falls back to the D1 store (which errors on use) when nothing is configured', async () => {
    expect(await resolveDashboardStore()).toBeInstanceOf(D1DashboardStore)
  })
})
