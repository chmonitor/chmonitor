import {
  getAndValidatePostgresConfig,
  getPostgresConfigs,
} from './postgres-config'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const PG_ENV_KEYS = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
  'POSTGRES_SSLMODE',
  'POSTGRES_NAME',
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of PG_ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of PG_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('getPostgresConfigs — env-based pgHostId resolver', () => {
  test('returns an empty list when POSTGRES_HOST is unset', () => {
    expect(getPostgresConfigs()).toEqual([])
  })

  test('parses a single host with defaults', () => {
    process.env.POSTGRES_HOST = 'db.example.com'
    process.env.POSTGRES_USER = 'postgres'
    process.env.POSTGRES_PASSWORD = 'secret'
    process.env.POSTGRES_DATABASE = 'appdb'

    const configs = getPostgresConfigs()
    expect(configs).toHaveLength(1)
    expect(configs[0]).toEqual({
      id: 0,
      host: 'db.example.com',
      port: 5432,
      user: 'postgres',
      password: 'secret',
      database: 'appdb',
    })
  })

  test('honors an inline host:port and falls back to postgres/5432 defaults', () => {
    process.env.POSTGRES_HOST = 'db.example.com:5433'
    const [config] = getPostgresConfigs()
    expect(config.host).toBe('db.example.com')
    expect(config.port).toBe(5433)
    expect(config.user).toBe('postgres')
    expect(config.password).toBe('')
    expect(config.database).toBe('postgres')
  })

  test('POSTGRES_PORT list wins when no inline port is present', () => {
    process.env.POSTGRES_HOST = 'a.example.com,b.example.com'
    process.env.POSTGRES_PORT = '5432,6543'
    const configs = getPostgresConfigs()
    expect(configs.map((c) => c.port)).toEqual([5432, 6543])
  })

  test('broadcasts a single user/password across multiple hosts', () => {
    process.env.POSTGRES_HOST = 'a.example.com,b.example.com'
    process.env.POSTGRES_USER = 'shared'
    process.env.POSTGRES_PASSWORD = 'pw'
    const configs = getPostgresConfigs()
    expect(configs.map((c) => c.user)).toEqual(['shared', 'shared'])
    expect(configs.map((c) => c.password)).toEqual(['pw', 'pw'])
  })

  test('carries sslmode and customName when provided', () => {
    process.env.POSTGRES_HOST = 'db.example.com'
    process.env.POSTGRES_SSLMODE = 'verify-full'
    process.env.POSTGRES_NAME = 'Prod'
    const [config] = getPostgresConfigs()
    expect(config.sslmode).toBe('verify-full')
    expect(config.customName).toBe('Prod')
  })
})

describe('getAndValidatePostgresConfig', () => {
  test('throws a clear error when no sources are configured', () => {
    expect(() => getAndValidatePostgresConfig(0)).toThrow(
      /No Postgres sources configured/
    )
  })

  test('throws with the available range when pgHostId is out of range', () => {
    process.env.POSTGRES_HOST = 'a.example.com,b.example.com'
    expect(() => getAndValidatePostgresConfig(5)).toThrow(
      /Invalid pgHostId: 5\. Available Postgres sources: 0-1/
    )
  })

  test('resolves a valid pgHostId', () => {
    process.env.POSTGRES_HOST = 'a.example.com,b.example.com'
    expect(getAndValidatePostgresConfig(1).host).toBe('b.example.com')
  })
})
