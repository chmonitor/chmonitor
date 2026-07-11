import {
  buildPeerDBAuthHeader,
  buildPeerdbCredentialFields,
  envPeerDBConfig,
  parsePeerDBAuthScheme,
  peerdbConfigFromCredentials,
  selectPeerDBSource,
} from './peerdb-auth'
import { describe, expect, test } from 'bun:test'

describe('parsePeerDBAuthScheme', () => {
  test('defaults to basic', () => {
    expect(parsePeerDBAuthScheme(undefined)).toBe('basic')
    expect(parsePeerDBAuthScheme('')).toBe('basic')
    expect(parsePeerDBAuthScheme('anything')).toBe('basic')
  })
  test('recognises bearer (case/space-insensitive)', () => {
    expect(parsePeerDBAuthScheme('bearer')).toBe('bearer')
    expect(parsePeerDBAuthScheme('  Bearer ')).toBe('bearer')
  })
})

describe('buildPeerDBAuthHeader', () => {
  test('basic uses an empty username: base64(":" + secret)', () => {
    const header = buildPeerDBAuthHeader({ authScheme: 'basic', secret: 'pw' })
    expect(header.Authorization).toBe(`Basic ${btoa(':pw')}`)
  })
  test('default scheme (undefined) is treated as basic', () => {
    const header = buildPeerDBAuthHeader({ secret: 'pw' })
    expect(header.Authorization).toBe(`Basic ${btoa(':pw')}`)
  })
  test('bearer emits a Bearer token', () => {
    const header = buildPeerDBAuthHeader({
      authScheme: 'bearer',
      secret: 'tok',
    })
    expect(header.Authorization).toBe('Bearer tok')
  })
  test('no secret ⇒ no header (open flow-api)', () => {
    expect(buildPeerDBAuthHeader({ authScheme: 'bearer' })).toEqual({})
    expect(buildPeerDBAuthHeader({ secret: '   ' })).toEqual({})
  })
})

describe('envPeerDBConfig', () => {
  test('null when PEERDB_API_URL is unset/blank', () => {
    expect(envPeerDBConfig({})).toBeNull()
    expect(envPeerDBConfig({ PEERDB_API_URL: '  ' })).toBeNull()
  })
  test('strips trailing slashes and reads the password', () => {
    const cfg = envPeerDBConfig({
      PEERDB_API_URL: 'http://flow-api:8113///',
      PEERDB_PASSWORD: 'pw',
    })
    expect(cfg).toEqual({
      baseUrl: 'http://flow-api:8113',
      authScheme: 'basic',
      secret: 'pw',
    })
  })
  test('honours PEERDB_AUTH_SCHEME=bearer', () => {
    const cfg = envPeerDBConfig({
      PEERDB_API_URL: 'http://flow-api:8113',
      PEERDB_PASSWORD: 'tok',
      PEERDB_AUTH_SCHEME: 'bearer',
    })
    expect(cfg?.authScheme).toBe('bearer')
  })
  test('no scheme when there is no password', () => {
    const cfg = envPeerDBConfig({ PEERDB_API_URL: 'http://flow-api:8113' })
    expect(cfg).toEqual({
      baseUrl: 'http://flow-api:8113',
      authScheme: undefined,
      secret: undefined,
    })
  })
})

describe('peerdbConfigFromCredentials', () => {
  test('null when no peerdbApiUrl', () => {
    expect(peerdbConfigFromCredentials({})).toBeNull()
  })
  test('resolves url + scheme + secret', () => {
    const cfg = peerdbConfigFromCredentials({
      peerdbApiUrl: 'https://peerdb.example.com/api/',
      peerdbAuthScheme: 'bearer',
      peerdbAuthSecret: 'tok',
    })
    expect(cfg).toEqual({
      baseUrl: 'https://peerdb.example.com/api',
      authScheme: 'bearer',
      secret: 'tok',
    })
  })
  test('url only ⇒ open (no scheme/secret)', () => {
    const cfg = peerdbConfigFromCredentials({
      peerdbApiUrl: 'http://localhost:8113',
    })
    expect(cfg).toEqual({
      baseUrl: 'http://localhost:8113',
      authScheme: undefined,
      secret: undefined,
    })
  })
})

describe('buildPeerdbCredentialFields', () => {
  test('no apiUrl ⇒ no fields', () => {
    expect(buildPeerdbCredentialFields({})).toEqual({ fields: {} })
    expect(buildPeerdbCredentialFields({ apiUrl: '   ' })).toEqual({
      fields: {},
    })
  })
  test('rejects an unknown scheme', () => {
    const res = buildPeerdbCredentialFields({
      apiUrl: 'https://x',
      scheme: 'weird',
    })
    expect(res.error).toBeDefined()
    expect(res.fields).toEqual({})
  })
  test('apiUrl only ⇒ url field, no secret', () => {
    const res = buildPeerdbCredentialFields({ apiUrl: ' https://x ' })
    expect(res.error).toBeUndefined()
    expect(res.fields).toEqual({ peerdbApiUrl: 'https://x' })
  })
  test('apiUrl + secret defaults scheme to basic', () => {
    const res = buildPeerdbCredentialFields({
      apiUrl: 'https://x',
      secret: 'pw',
    })
    expect(res.fields).toEqual({
      peerdbApiUrl: 'https://x',
      peerdbAuthScheme: 'basic',
      peerdbAuthSecret: 'pw',
    })
  })
  test('empty secret is dropped (URL-only)', () => {
    const res = buildPeerdbCredentialFields({
      apiUrl: 'https://x',
      scheme: 'bearer',
      secret: '',
    })
    expect(res.fields).toEqual({ peerdbApiUrl: 'https://x' })
  })
})

describe('selectPeerDBSource (fallback logic)', () => {
  const env = { baseUrl: 'http://env:8113' }
  const conn = { baseUrl: 'http://conn:8113' }

  test('no selector ⇒ env config', () => {
    expect(selectPeerDBSource({ connectionConfig: null, envConfig: env })).toBe(
      env
    )
  })
  test('selector ⇒ the connection config (never falls back to env)', () => {
    expect(
      selectPeerDBSource({
        connectionId: 'abc',
        connectionConfig: conn,
        envConfig: env,
      })
    ).toBe(conn)
  })
  test('selector with no connection config ⇒ null (not env)', () => {
    expect(
      selectPeerDBSource({
        connectionId: 'abc',
        connectionConfig: null,
        envConfig: env,
      })
    ).toBeNull()
  })
})
