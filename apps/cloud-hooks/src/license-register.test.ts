import type { Env } from './env'

import worker from './index'
import {
  LICENSE_PUBLIC_INDEX_KEY,
  LICENSE_REG_KEY_PREFIX,
} from './license-http'
import {
  handleLicensePublic,
  handleLicenseRegister,
  type LicenseKV,
} from './license-register'
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

function post(body: unknown): Request {
  return new Request('https://hooks.chmonitor.dev/licenses/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const valid = {
  company: 'Acme Analytics',
  website: 'https://acme.example',
  sku: 'team',
  term: 'yearly',
  list_public: true,
  checkout_id: 'chk_1',
}

describe('POST /licenses/register', () => {
  test('stores the row and appends opt-in names to the public index after Polar proof', async () => {
    const kv = makeKV()
    const fetchImpl = async (url: string) => {
      if (url.includes('/v1/checkouts/chk_1')) {
        return new Response(
          JSON.stringify({
            id: 'chk_1',
            status: 'succeeded',
            metadata: { sku: 'team', term: 'yearly' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response('{}', { status: 404 })
    }
    const res = await handleLicenseRegister(
      post(valid),
      { POLAR_ACCESS_TOKEN: 'polar_test' },
      {
        kv,
        uuid: () => 'reg-1',
        now: () => new Date('2026-08-17T00:00:00.000Z'),
        fetchImpl,
      }
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true, id: 'reg-1' })

    const stored = JSON.parse(
      (await kv.get(`${LICENSE_REG_KEY_PREFIX}reg-1`)) ?? '{}'
    )
    expect(stored).toMatchObject({
      company: 'Acme Analytics',
      website: 'https://acme.example/',
      sku: 'team',
      term: 'yearly',
      list_public: true,
      checkout_id: 'chk_1',
    })

    const pub = await handleLicensePublic(
      new Request('https://hooks.chmonitor.dev/licenses/public'),
      {},
      { kv }
    )
    expect(pub.status).toBe(200)
    expect(await pub.json()).toEqual({
      licenses: [
        {
          company: 'Acme Analytics',
          website: 'https://acme.example/',
          sku: 'team',
          term: 'yearly',
          registered_at: '2026-08-17T00:00:00.000Z',
        },
      ],
    })
  })

  test('unpaid or mismatched checkout stays off the public wall', async () => {
    const kv = makeKV()
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: 'chk_1',
          status: 'open',
          metadata: { sku: 'team', term: 'yearly' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    const res = await handleLicenseRegister(
      post(valid),
      { POLAR_ACCESS_TOKEN: 'polar_test' },
      { kv, uuid: () => 'reg-2', fetchImpl }
    )
    expect(res.status).toBe(201)
    const pub = await handleLicensePublic(
      new Request('https://hooks.chmonitor.dev/licenses/public'),
      {},
      { kv }
    )
    expect(await pub.json()).toEqual({ licenses: [] })
  })

  test('rate limit blocks the 11th registration in an hour', async () => {
    const kv = makeKV()
    const nowMs = 1_700_000_000_000
    for (let i = 0; i < 10; i++) {
      const req = new Request('https://hooks.chmonitor.dev/licenses/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.1',
        },
        body: JSON.stringify({ ...valid, company: `Co ${i}` }),
      })
      const res = await handleLicenseRegister(
        req,
        {},
        { kv, uuid: () => `reg-${i}`, nowMs }
      )
      expect(res.status).toBe(201)
    }
    const blocked = await handleLicenseRegister(
      new Request('https://hooks.chmonitor.dev/licenses/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.1',
        },
        body: JSON.stringify(valid),
      }),
      {},
      { kv, uuid: () => 'reg-blocked', nowMs }
    )
    expect(blocked.status).toBe(429)
  })

  test('intent without checkout_id is stored but stays off the public wall', async () => {
    const kv = makeKV()
    const res = await handleLicenseRegister(
      post({
        company: 'Lead Co',
        website: 'https://lead.example',
        sku: 'team',
        term: 'yearly',
        list_public: true,
        email: 'ops@lead.example',
      }),
      {},
      { kv, uuid: () => 'lead-1' }
    )
    expect(res.status).toBe(201)
    expect(await kv.get(`${LICENSE_REG_KEY_PREFIX}lead-1`)).toContain('Lead Co')
    const pub = await handleLicensePublic(
      new Request('https://hooks.chmonitor.dev/licenses/public'),
      {},
      { kv }
    )
    expect(await pub.json()).toEqual({ licenses: [] })
  })

  test('private rows stay off GET /licenses/public', async () => {
    const kv = makeKV()
    await handleLicenseRegister(
      post({ ...valid, list_public: false }),
      {},
      { kv, uuid: () => 'priv' }
    )
    const pub = await handleLicensePublic(
      new Request('https://hooks.chmonitor.dev/licenses/public'),
      {},
      { kv }
    )
    expect(await pub.json()).toEqual({ licenses: [] })
    expect(kv.store.has(`${LICENSE_REG_KEY_PREFIX}priv`)).toBe(true)
    expect(kv.store.has(LICENSE_PUBLIC_INDEX_KEY)).toBe(false)
  })

  test('400 on bad payload, 501 without KV', async () => {
    const kv = makeKV()
    expect(
      (await handleLicenseRegister(post({ ...valid, company: '' }), {}, { kv }))
        .status
    ).toBe(400)
    expect(
      (
        await handleLicenseRegister(
          post({ ...valid, website: 'not-a-url' }),
          {},
          { kv }
        )
      ).status
    ).toBe(400)
    expect(
      (
        await handleLicenseRegister(
          post({ ...valid, sku: 'personal' }),
          {},
          { kv }
        )
      ).status
    ).toBe(400)
    expect(
      (await handleLicenseRegister(post(valid), {}, { kv: null })).status
    ).toBe(501)
  })

  test('router wires POST /licenses/register and GET /licenses/public', async () => {
    const env: Env = {}
    const missing = await worker.fetch(post(valid), env)
    expect(missing.status).toBe(501)
    const pub = await worker.fetch(
      new Request('https://hooks.chmonitor.dev/licenses/public'),
      env
    )
    expect(pub.status).toBe(200)
    expect(await pub.json()).toEqual({ licenses: [] })
  })
})
