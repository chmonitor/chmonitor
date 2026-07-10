import { decryptCredentials, encryptCredentials } from '../crypto'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

describe('connection-store crypto', () => {
  const originalKey = process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY

  beforeEach(() => {
    // 32 zero bytes, base64
    process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY
    } else {
      process.env.CHM_USER_CONNECTIONS_ENCRYPTION_KEY = originalKey
    }
  })

  it('round-trips credentials', async () => {
    const input = {
      host: 'https://clickhouse.example.com:8443',
      user: 'default',
      password: 'secret',
    }
    const encrypted = await encryptCredentials(input)
    const decrypted = await decryptCredentials(encrypted)
    expect(decrypted).toEqual(input)
  })

  // Envelope v2 (Postgres): the credential JSON gains kind/port/database/sslmode.
  it('round-trips a v2 Postgres envelope', async () => {
    const input = {
      kind: 'postgres' as const,
      host: 'db.example.com',
      user: 'postgres',
      password: 'secret',
      port: 5432,
      database: 'app',
      sslmode: 'require',
    }
    const encrypted = await encryptCredentials(input)
    const decrypted = await decryptCredentials(encrypted)
    expect(decrypted).toEqual(input)
  })

  // Back-compat: a v1 payload (no `kind`) still decrypts, and its absent `kind`
  // is what lets every reader treat legacy rows as ClickHouse.
  it('decrypts a v1 payload with no kind (reads back as ClickHouse)', async () => {
    const v1 = {
      host: 'https://clickhouse.example.com:8443',
      user: 'default',
      password: 'secret',
    }
    const encrypted = await encryptCredentials(v1)
    const decrypted = await decryptCredentials(encrypted)
    expect(decrypted.kind).toBeUndefined()
    expect(decrypted).toEqual(v1)
  })
})
