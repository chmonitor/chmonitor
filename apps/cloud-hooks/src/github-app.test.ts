/**
 * GitHub App auth: JWT claim shape, PEM normalization, RS256 signing (verified
 * against the public key), installation-token cache + expiry, 401-refresh-once,
 * and the App→PAT→disabled resolution order. No network — fetch/KV are mocked.
 */

import type { KVLike } from './exceptions'

import {
  buildJwtClaims,
  createAppJwt,
  GitHubAppAuth,
  isTokenFresh,
  normalizePrivateKey,
  resolveGitHubAuth,
  resolveInstallationId,
  TOKEN_EXPIRY_MARGIN_MS,
  withTokenRefresh,
} from './github-app'
import { beforeAll, describe, expect, mock, test } from 'bun:test'

// A real RSA key pair generated once, exported to a PKCS#8 PEM, so signing
// exercises WebCrypto for real (and we can verify the signature).
let pkcs8Pem = ''
let publicKey: CryptoKey

function derToPem(der: ArrayBuffer, label: string): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)))
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  )
  publicKey = pair.publicKey
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  pkcs8Pem = derToPem(pkcs8, 'PRIVATE KEY')
})

function makeKV(initial?: Record<string, string>): KVLike & {
  store: Map<string, string>
} {
  const store = new Map(Object.entries(initial ?? {}))
  return {
    store,
    async get(k) {
      return store.get(k) ?? null
    },
    async put(k, v) {
      store.set(k, v)
    },
  }
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)))
}

describe('buildJwtClaims', () => {
  test('iat backdated 60s, exp +9min, iss = appId', () => {
    const now = 1_700_000_000_000 // fixed ms
    const claims = buildJwtClaims('123456', now)
    const nowSec = Math.floor(now / 1000)
    expect(claims.iat).toBe(nowSec - 60)
    expect(claims.exp).toBe(nowSec + 9 * 60)
    expect(claims.iss).toBe('123456')
    // GitHub rejects >10min lifetime; ours is 10min total (−60s..+540s).
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600)
  })
})

describe('normalizePrivateKey', () => {
  test('escaped \\n newlines normalize to the same DER as real newlines', () => {
    const real = normalizePrivateKey(pkcs8Pem)
    const escaped = normalizePrivateKey(pkcs8Pem.replace(/\n/g, '\\n'))
    expect(Array.from(escaped)).toEqual(Array.from(real))
  })

  test('PKCS#1 key throws with an openssl-conversion hint', () => {
    const pkcs1 =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIfake\n-----END RSA PRIVATE KEY-----'
    expect(() => normalizePrivateKey(pkcs1)).toThrow(/pkcs8 -topk8/)
  })

  test('non-PEM input throws', () => {
    expect(() => normalizePrivateKey('not a key')).toThrow(/PKCS#8 PEM/)
  })
})

describe('createAppJwt', () => {
  test('produces a 3-part RS256 JWT that verifies against the public key', async () => {
    const now = 1_700_000_000_000
    const jwt = await createAppJwt('42', pkcs8Pem, now)
    const [h, p, s] = jwt.split('.')
    expect(h && p && s).toBeTruthy()

    const header = decodeJwtPart(h)
    expect(header.alg).toBe('RS256')
    expect(header.typ).toBe('JWT')

    const payload = decodeJwtPart(p)
    expect(payload.iss).toBe('42')
    expect(payload.iat).toBe(Math.floor(now / 1000) - 60)

    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${p}`)
    )
    expect(ok).toBe(true)
  })
})

describe('isTokenFresh', () => {
  const now = 1_700_000_000_000
  test('fresh when now is before expiry minus margin', () => {
    expect(
      isTokenFresh(
        { token: 't', expiresAt: now + TOKEN_EXPIRY_MARGIN_MS + 1 },
        now
      )
    ).toBe(true)
  })
  test('stale within the margin', () => {
    expect(
      isTokenFresh(
        { token: 't', expiresAt: now + TOKEN_EXPIRY_MARGIN_MS - 1 },
        now
      )
    ).toBe(false)
  })
})

const appCfg = {
  appId: '1',
  owner: 'chmonitor',
  repo: 'chmonitor',
  installationId: '999',
}

describe('resolveInstallationId', () => {
  test('returns explicit id without a network call', async () => {
    const fetchImpl = mock(async () => new Response('{}'))
    const id = await resolveInstallationId(
      { ...appCfg, privateKeyPem: pkcs8Pem },
      'jwt',
      null,
      fetchImpl as unknown as typeof fetch
    )
    expect(id).toBe('999')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('resolves from repo + caches in KV when id is unset', async () => {
    const kv = makeKV()
    const fetchImpl = mock(
      async () => new Response(JSON.stringify({ id: 555 }), { status: 200 })
    )
    const cfg = { appId: '1', owner: 'o', repo: 'r', privateKeyPem: pkcs8Pem }
    const id = await resolveInstallationId(
      cfg,
      'jwt',
      kv,
      fetchImpl as unknown as typeof fetch
    )
    expect(id).toBe('555')
    expect(kv.store.get('gh-app:install-id:v1:o/r')).toBe('555')
    // Second call hits KV, not the network.
    const fetch2 = mock(async () => new Response('{}'))
    const id2 = await resolveInstallationId(
      cfg,
      'jwt',
      kv,
      fetch2 as unknown as typeof fetch
    )
    expect(id2).toBe('555')
    expect(fetch2).not.toHaveBeenCalled()
  })
})

describe('GitHubAppAuth token cache', () => {
  test('mints + caches an installation token, reuses a fresh cache', async () => {
    const kv = makeKV()
    let mintCount = 0
    const fetchImpl = mock(async (url: string) => {
      if (url.includes('/access_tokens')) {
        mintCount++
        return new Response(
          JSON.stringify({
            token: `ghs_minted_${mintCount}`,
            expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          }),
          { status: 201 }
        )
      }
      return new Response('{}', { status: 200 })
    })
    const auth = new GitHubAppAuth({
      cfg: { ...appCfg, privateKeyPem: pkcs8Pem },
      kv,
      fetch: fetchImpl as unknown as typeof fetch,
    })
    const t1 = await auth.getToken()
    expect(t1).toBe('ghs_minted_1')
    expect(kv.store.has('gh-app:token:v1:chmonitor/chmonitor')).toBe(true)
    // Cached + fresh → no second mint.
    const t2 = await auth.getToken()
    expect(t2).toBe('ghs_minted_1')
    expect(mintCount).toBe(1)
  })

  test('near-expiry cache is refreshed', async () => {
    const kv = makeKV({
      'gh-app:token:v1:chmonitor/chmonitor': JSON.stringify({
        token: 'ghs_old',
        expiresAt: Date.now() + TOKEN_EXPIRY_MARGIN_MS - 1_000, // within margin
      }),
    })
    const fetchImpl = mock(
      async () =>
        new Response(
          JSON.stringify({
            token: 'ghs_fresh',
            expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          }),
          { status: 201 }
        )
    )
    const auth = new GitHubAppAuth({
      cfg: { ...appCfg, privateKeyPem: pkcs8Pem },
      kv,
      fetch: fetchImpl as unknown as typeof fetch,
    })
    expect(await auth.getToken()).toBe('ghs_fresh')
  })
})

describe('withTokenRefresh', () => {
  test('refreshes once on 401 then retries with the new token', async () => {
    const fetchImpl = mock(
      async () =>
        new Response(
          JSON.stringify({
            token: 'ghs_refreshed',
            expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
          }),
          { status: 201 }
        )
    )
    const auth = new GitHubAppAuth({
      cfg: { ...appCfg, privateKeyPem: pkcs8Pem },
      kv: null,
      fetch: fetchImpl as unknown as typeof fetch,
    })
    const seen: string[] = []
    const op = async (token: string) => {
      seen.push(token)
      return { status: seen.length === 1 ? 401 : 201 }
    }
    const res = await withTokenRefresh(auth, op, 'stale-token')
    expect(res.status).toBe(201)
    expect(seen).toEqual(['stale-token', 'ghs_refreshed'])
  })

  test('non-401 result is returned without a refresh', async () => {
    const auth = new GitHubAppAuth({
      cfg: { ...appCfg, privateKeyPem: pkcs8Pem },
      kv: null,
      fetch: mock(async () => new Response('{}')) as unknown as typeof fetch,
    })
    let calls = 0
    const op = async () => {
      calls++
      return { status: 201 }
    }
    const res = await withTokenRefresh(auth, op, 'tok')
    expect(res.status).toBe(201)
    expect(calls).toBe(1)
  })

  test('PAT (null auth) never refreshes even on 401', async () => {
    let calls = 0
    const op = async () => {
      calls++
      return { status: 401 }
    }
    const res = await withTokenRefresh(null, op, 'pat')
    expect(res.status).toBe(401)
    expect(calls).toBe(1)
  })
})

describe('resolveGitHubAuth — order', () => {
  test('App creds → app mode (precedence over PAT)', () => {
    const r = resolveGitHubAuth(
      { GH_APP_ID: '1', GH_APP_PRIVATE_KEY: pkcs8Pem, GITHUB_TOKEN: 'pat' },
      'o',
      'r',
      null
    )
    expect(r.mode).toBe('app')
    expect(r.app).toBeInstanceOf(GitHubAppAuth)
  })

  test('only PAT → pat mode', () => {
    const r = resolveGitHubAuth({ GITHUB_TOKEN: 'pat' }, 'o', 'r', null)
    expect(r.mode).toBe('pat')
    expect(r.token).toBe('pat')
  })

  test('no creds → disabled', () => {
    expect(resolveGitHubAuth({}, 'o', 'r', null).mode).toBe('disabled')
  })

  test('App id without a key falls back to PAT', () => {
    const r = resolveGitHubAuth(
      { GH_APP_ID: '1', GITHUB_TOKEN: 'pat' },
      'o',
      'r',
      null
    )
    expect(r.mode).toBe('pat')
  })
})
