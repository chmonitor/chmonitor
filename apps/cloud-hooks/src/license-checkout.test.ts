import type { Env } from './env'

import worker from './index'
import { handleLicenseCheckout } from './license-checkout'
import { licenseSuccessUrl } from './license-http'
import { describe, expect, mock, test } from 'bun:test'

const env: Env = {
  POLAR_ACCESS_TOKEN: 'polar_test',
  CHM_POLAR_SERVER: 'sandbox',
  CHM_POLAR_LICENSE_TEAM_YEARLY: 'prod_team_y',
  CHM_POLAR_LICENSE_TEAM_LIFETIME: 'prod_team_l',
  CHM_POLAR_LICENSE_UNLIMITED_YEARLY: 'prod_unl_y',
  CHM_POLAR_LICENSE_UNLIMITED_LIFETIME: 'prod_unl_l',
}

function req(query: string, method = 'GET'): Request {
  return new Request(`https://hooks.chmonitor.dev/checkout/license?${query}`, {
    method,
  })
}

describe('GET /checkout/license', () => {
  test('302 to Polar with product, metadata, and {CHECKOUT_ID} success_url', async () => {
    const fetchImpl = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >
      expect(body.products).toEqual(['prod_team_y'])
      expect(body.external_customer_id).toBe('license_team_yearly_fixed')
      expect(body.success_url).toBe(
        'https://chmonitor.dev/license/register?sku=team&term=yearly&paid=1&checkout_id={CHECKOUT_ID}'
      )
      expect(body.success_url).toContain('{CHECKOUT_ID}')
      expect(body.metadata).toEqual({
        kind: 'selfhost-license',
        sku: 'team',
        term: 'yearly',
      })
      return new Response(
        JSON.stringify({ url: 'https://polar.sh/checkout/lic' }),
        { status: 201 }
      )
    })
    const res = await handleLicenseCheckout(req('sku=team&term=yearly'), env, {
      fetchImpl,
      uuid: () => 'fixed',
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://polar.sh/checkout/lic')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const called = String(fetchImpl.mock.calls[0]?.[0])
    expect(called).toBe('https://sandbox-api.polar.sh/v1/checkouts/')
  })

  test('lifetime unlimited uses the lifetime product and production host', async () => {
    const fetchImpl = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >
      expect(body.products).toEqual(['prod_unl_l'])
      return new Response(JSON.stringify({ url: 'https://polar.sh/c' }), {
        status: 200,
      })
    })
    const res = await handleLicenseCheckout(
      req('sku=unlimited&term=lifetime'),
      { ...env, CHM_POLAR_SERVER: 'production' },
      { fetchImpl }
    )
    expect(res.status).toBe(302)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://api.polar.sh/v1/checkouts/'
    )
  })

  test('400 on bad sku or term', async () => {
    expect(
      (await handleLicenseCheckout(req('sku=pro&term=yearly'), env)).status
    ).toBe(400)
    expect(
      (await handleLicenseCheckout(req('sku=team&term=monthly'), env)).status
    ).toBe(400)
  })

  test('501 when token or product id is missing', async () => {
    const noToken = await handleLicenseCheckout(req('sku=team&term=yearly'), {
      ...env,
      POLAR_ACCESS_TOKEN: undefined,
    })
    expect(noToken.status).toBe(501)
    expect(await noToken.json()).toEqual({ error: 'billing is not enabled' })

    const noProduct = await handleLicenseCheckout(req('sku=team&term=yearly'), {
      POLAR_ACCESS_TOKEN: 'x',
    })
    expect(noProduct.status).toBe(501)
    expect(((await noProduct.json()) as { error: string }).error).toMatch(
      /no Polar product/
    )
  })

  test('502 JSON {error, status} when Polar rejects — never throws', async () => {
    const fetchImpl = mock(
      async () =>
        new Response('{"detail":"success_url must contain {CHECKOUT_ID}"}', {
          status: 422,
        })
    )
    const res = await handleLicenseCheckout(req('sku=team&term=yearly'), env, {
      fetchImpl,
    })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'polar_error', status: 422 })
  })

  test('502 when Polar returns no checkout url or fetch throws', async () => {
    const empty = await handleLicenseCheckout(
      req('sku=team&term=yearly'),
      env,
      {
        fetchImpl: mock(async () => new Response('{}', { status: 200 })),
      }
    )
    expect(empty.status).toBe(502)

    const boom = await handleLicenseCheckout(req('sku=team&term=yearly'), env, {
      fetchImpl: mock(async () => {
        throw new Error('network')
      }),
    })
    expect(boom.status).toBe(502)
    expect(await boom.json()).toEqual({ error: 'polar_error', status: 502 })
  })

  test('router wires GET /checkout/license and rejects POST', async () => {
    const bad = await worker.fetch(req('sku=nope&term=yearly'), env)
    expect(bad.status).toBe(400)
    const post = await worker.fetch(req('sku=team&term=yearly', 'POST'), env)
    expect(post.status).toBe(405)
  })
})

describe('licenseSuccessUrl', () => {
  test('always embeds the Polar {CHECKOUT_ID} placeholder', () => {
    expect(licenseSuccessUrl('team', 'yearly')).toContain('{CHECKOUT_ID}')
  })
})
