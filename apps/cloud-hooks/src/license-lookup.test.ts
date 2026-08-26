import type { Env } from './env'

import worker from './index'
import { handleLicenseLookup } from './license-lookup'
import { describe, expect, mock, test } from 'bun:test'

const env: Env = {
  POLAR_ACCESS_TOKEN: 'polar_test',
  CHM_POLAR_SERVER: 'sandbox',
}

function req(q: string, method = 'GET'): Request {
  return new Request(
    `https://hooks.chmonitor.dev/licenses/lookup?q=${encodeURIComponent(q)}`,
    { method }
  )
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('GET /licenses/lookup', () => {
  test('returns a succeeded Polar checkout', async () => {
    const fetchImpl = mock(async (url: string) => {
      expect(url).toContain('/v1/checkouts/chk_1')
      return jsonRes(200, {
        id: 'chk_1',
        status: 'succeeded',
        customer_email: 'ops@acme.example',
        metadata: { kind: 'selfhost-license', sku: 'team', term: 'yearly' },
      })
    })
    const res = await handleLicenseLookup(req('chk_1'), env, { fetchImpl })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      found: true,
      source: 'checkout',
      sku: 'team',
      term: 'yearly',
      paid: true,
    })
    expect(body).not.toHaveProperty('email')
    expect(body).not.toHaveProperty('status')
  })

  test('looks up a customer by email and 404s when Polar has none', async () => {
    const fetchImpl = mock(async (url: string) => {
      expect(url).toContain('/v1/customers/?email=ops%40acme.example')
      return jsonRes(200, { items: [] })
    })
    const res = await handleLicenseLookup(req('ops@acme.example'), env, {
      fetchImpl,
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  test('falls through checkout miss to customer query', async () => {
    const fetchImpl = mock(async (url: string) => {
      if (url.includes('/v1/checkouts/'))
        return jsonRes(404, { detail: 'Not found' })
      if (url.includes('/v1/customers/external/')) {
        return jsonRes(200, { id: 'cus_1', email: 'ops@acme.example' })
      }
      return jsonRes(404, {})
    })
    const res = await handleLicenseLookup(req('license_team_yearly_abc'), env, {
      fetchImpl,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { source: string; found: boolean }
    expect(body.found).toBe(true)
    expect(body.source).toBe('customer')
  })

  test('400 empty q, 501 without token, 502 Polar 5xx, never throws', async () => {
    expect((await handleLicenseLookup(req(''), env)).status).toBe(400)
    expect(
      (await handleLicenseLookup(req('chk'), { POLAR_ACCESS_TOKEN: undefined }))
        .status
    ).toBe(501)

    const five = await handleLicenseLookup(req('chk'), env, {
      fetchImpl: mock(async () => jsonRes(503, { detail: 'down' })),
    })
    expect(five.status).toBe(502)
    expect(await five.json()).toEqual({ error: 'polar_error', status: 503 })

    const boom = await handleLicenseLookup(req('chk'), env, {
      fetchImpl: mock(async () => {
        throw new Error('network')
      }),
    })
    expect(boom.status).toBe(502)
  })

  test('router wires GET /licenses/lookup', async () => {
    const res = await worker.fetch(req(''), env)
    expect(res.status).toBe(400)
  })
})
