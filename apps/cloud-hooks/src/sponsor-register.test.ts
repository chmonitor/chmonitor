import type { Env } from './env'
import type { LicenseKV } from './license-http'

import worker from './index'
import {
  handleSponsorRegister,
  SPONSOR_REG_KEY_PREFIX,
} from './sponsor-register'
import { describe, expect, test } from 'bun:test'

function makeKV(initial?: Record<string, string>): LicenseKV & {
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

function post(body: unknown, ip = '203.0.113.9'): Request {
  return new Request('https://hooks.chmonitor.dev/sponsors/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  })
}

const valid = {
  name: 'Acme Analytics',
  website: 'https://acme.example',
  email: 'ops@acme.example',
  tier: 'backer',
  checkout_id: 'chk_1',
  logo: '/sponsors/acme.svg',
}

describe('POST /sponsors/register', () => {
  test('stores name, website, email, and tier, and returns only the id', async () => {
    const kv = makeKV()
    const res = await handleSponsorRegister(
      post(valid),
      {},
      {
        kv,
        uuid: () => 'sp-1',
        now: () => new Date('2026-09-20T00:00:00.000Z'),
      }
    )
    expect(res.status).toBe(201)
    // The response must not echo the sponsor's email back at the caller.
    expect(await res.json()).toEqual({ ok: true, id: 'sp-1' })

    const stored = JSON.parse(
      (await kv.get(`${SPONSOR_REG_KEY_PREFIX}sp-1`)) ?? '{}'
    )
    expect(stored).toEqual({
      id: 'sp-1',
      name: 'Acme Analytics',
      website: 'https://acme.example/',
      email: 'ops@acme.example',
      tier: 'backer',
      checkout_id: 'chk_1',
      logo: '/sponsors/acme.svg',
      registered_at: '2026-09-20T00:00:00.000Z',
    })
  })

  test('checkout_id and logo are optional', async () => {
    const kv = makeKV()
    const res = await handleSponsorRegister(
      post({
        name: 'Lead Co',
        website: 'https://lead.example',
        email: 'a@b.example',
        tier: 'supporter',
      }),
      {},
      { kv, uuid: () => 'sp-2' }
    )
    expect(res.status).toBe(201)
    const stored = JSON.parse(
      (await kv.get(`${SPONSOR_REG_KEY_PREFIX}sp-2`)) ?? '{}'
    )
    expect(stored.checkout_id).toBeUndefined()
    expect(stored.logo).toBeUndefined()
    expect(stored.tier).toBe('supporter')
  })

  test('400 on a missing name, a non-http website, a bad email, an unknown tier', async () => {
    const kv = makeKV()
    const cases: Array<[string, unknown]> = [
      ['name', { ...valid, name: '' }],
      ['website', { ...valid, website: 'not-a-url' }],
      ['website protocol', { ...valid, website: 'javascript:alert(1)' }],
      ['email', { ...valid, email: 'nope' }],
      ['tier', { ...valid, tier: 'platinum' }],
    ]
    for (const [label, body] of cases) {
      const res = await handleSponsorRegister(post(body), {}, { kv })
      expect(res.status, label).toBe(400)
    }
    // Nothing but the rate-limit counter may be written.
    expect(
      [...kv.store.keys()].filter((k) => k.startsWith(SPONSOR_REG_KEY_PREFIX))
    ).toEqual([])
  })

  test('400 on a non-JSON body', async () => {
    const kv = makeKV()
    const res = await handleSponsorRegister(
      new Request('https://hooks.chmonitor.dev/sponsors/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
      {},
      { kv }
    )
    expect(res.status).toBe(400)
  })

  test('strips angle brackets from the published name', async () => {
    const kv = makeKV()
    await handleSponsorRegister(
      post({ ...valid, name: '<script>alert(1)</script>' }),
      {},
      { kv, uuid: () => 'sp-xss' }
    )
    const stored = (await kv.get(`${SPONSOR_REG_KEY_PREFIX}sp-xss`)) ?? ''
    expect(stored).not.toContain('<script>')
    expect(stored).toContain('scriptalert(1)/script')
  })

  test('rate limit blocks the 6th listing from one IP in an hour', async () => {
    const kv = makeKV()
    const nowMs = 1_789_000_000_000
    for (let i = 0; i < 5; i++) {
      const res = await handleSponsorRegister(
        post({ ...valid, name: `Co ${i}` }, '203.0.113.5'),
        {},
        { kv, uuid: () => `sp-${i}`, nowMs }
      )
      expect(res.status).toBe(201)
    }
    const blocked = await handleSponsorRegister(
      post({ ...valid, name: 'Co 6' }, '203.0.113.5'),
      {},
      { kv, uuid: () => 'sp-blocked', nowMs }
    )
    expect(blocked.status).toBe(429)
    // A different IP is unaffected.
    const other = await handleSponsorRegister(
      post({ ...valid, name: 'Co 7' }, '203.0.113.6'),
      {},
      { kv, uuid: () => 'sp-other', nowMs }
    )
    expect(other.status).toBe(201)
  })

  test('405 on GET, 501 without KV, 204 on preflight', async () => {
    const kv = makeKV()
    expect(
      (
        await handleSponsorRegister(
          new Request('https://hooks.chmonitor.dev/sponsors/register'),
          {},
          { kv }
        )
      ).status
    ).toBe(405)
    expect(
      (await handleSponsorRegister(post(valid), {}, { kv: null })).status
    ).toBe(501)
    const preflight = await handleSponsorRegister(
      new Request('https://hooks.chmonitor.dev/sponsors/register', {
        method: 'OPTIONS',
        headers: { origin: 'https://chmonitor.dev' },
      }),
      {},
      { kv }
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'https://chmonitor.dev'
    )
  })

  test('router wires POST /sponsors/register', async () => {
    const env: Env = {}
    const res = await worker.fetch(post(valid), env)
    // No KV binding on a bare env → 501, which proves the route is mounted.
    expect(res.status).toBe(501)
    const missing = await worker.fetch(
      new Request('https://hooks.chmonitor.dev/sponsors/nope', {
        method: 'POST',
      }),
      env
    )
    expect(missing.status).toBe(404)
  })
})
