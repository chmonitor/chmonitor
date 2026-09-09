import type { Env } from './env'

import {
  donateSuccessUrl,
  handleDonateCheckout,
  parseDonateAmount,
} from './donate-checkout'
import worker from './index'
import { describe, expect, mock, test } from 'bun:test'

const env: Env = {
  POLAR_ACCESS_TOKEN: 'polar_test',
  CHM_POLAR_SERVER: 'sandbox',
  CHM_POLAR_DONATE_PRODUCT: 'prod_donate',
}

function req(query: string, method = 'GET'): Request {
  return new Request(`https://hooks.chmonitor.dev/checkout/donate?${query}`, {
    method,
  })
}

describe('parseDonateAmount', () => {
  test('amount is USD dollars, converted to Polar cents', () => {
    expect(parseDonateAmount(new URL('https://x/d?amount=10'))).toEqual({
      cents: 1000,
    })
    expect(parseDonateAmount(new URL('https://x/d?amount=100'))).toEqual({
      cents: 10000,
    })
    expect(parseDonateAmount(new URL('https://x/d?amount=1000'))).toEqual({
      cents: 100000,
    })
    expect(parseDonateAmount(new URL('https://x/d?amount=10.5'))).toEqual({
      cents: 1050,
    })
  })

  test('cents is Polar-native and wins over amount', () => {
    expect(parseDonateAmount(new URL('https://x/d?cents=2500'))).toEqual({
      cents: 2500,
    })
    expect(
      parseDonateAmount(new URL('https://x/d?amount=10&cents=2500'))
    ).toEqual({ cents: 2500 })
  })

  test('rejects missing, below Polar USD min, and over the cap', () => {
    expect(parseDonateAmount(new URL('https://x/d'))).toMatchObject({
      error: expect.stringMatching(/required/i),
    })
    expect(parseDonateAmount(new URL('https://x/d?amount=0.25'))).toMatchObject(
      {
        error: expect.stringMatching(/at least/i),
      }
    )
    expect(parseDonateAmount(new URL('https://x/d?cents=49'))).toMatchObject({
      error: expect.stringMatching(/at least/i),
    })
    expect(
      parseDonateAmount(new URL('https://x/d?amount=10001'))
    ).toMatchObject({
      error: expect.stringMatching(/at most/i),
    })
    expect(parseDonateAmount(new URL('https://x/d?amount=nope'))).toMatchObject(
      {
        error: expect.stringMatching(/positive USD/i),
      }
    )
  })
})

describe('GET /checkout/donate', () => {
  test('302 to Polar with custom amount in cents and {CHECKOUT_ID} success_url', async () => {
    const fetchImpl = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >
      expect(body.products).toEqual(['prod_donate'])
      expect(body.amount).toBe(1000)
      expect(body.success_url).toBe(
        'https://chmonitor.dev/license?donated=1&checkout_id={CHECKOUT_ID}'
      )
      expect(body.metadata).toEqual({ kind: 'donate' })
      return new Response(
        JSON.stringify({
          id: 'chk_don',
          url: 'https://polar.sh/checkout/don',
        }),
        { status: 201 }
      )
    })
    const res = await handleDonateCheckout(req('amount=10'), env, {
      fetchImpl,
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://polar.sh/checkout/don')
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://sandbox-api.polar.sh/v1/checkouts/'
    )
  })

  test('chip $1000 and cents= query both convert correctly', async () => {
    const fetchImpl = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<
        string,
        unknown
      >
      expect(body.amount).toBe(100000)
      return new Response(JSON.stringify({ url: 'https://polar.sh/c' }), {
        status: 201,
      })
    })
    const dollars = await handleDonateCheckout(req('amount=1000'), env, {
      fetchImpl,
    })
    expect(dollars.status).toBe(302)
    const cents = await handleDonateCheckout(req('cents=100000'), env, {
      fetchImpl,
    })
    expect(cents.status).toBe(302)
  })

  test('400 on missing or invalid amount', async () => {
    expect((await handleDonateCheckout(req(''), env)).status).toBe(400)
    expect((await handleDonateCheckout(req('amount=0'), env)).status).toBe(400)
  })

  test('501 when token or donate product id is missing', async () => {
    const noToken = await handleDonateCheckout(req('amount=10'), {
      ...env,
      POLAR_ACCESS_TOKEN: undefined,
    })
    expect(noToken.status).toBe(501)
    expect(await noToken.json()).toEqual({ error: 'billing is not enabled' })

    const noProduct = await handleDonateCheckout(req('amount=10'), {
      POLAR_ACCESS_TOKEN: 'x',
    })
    expect(noProduct.status).toBe(501)
    expect(((await noProduct.json()) as { error: string }).error).toMatch(
      /no Polar donate product/
    )
  })

  test('502 JSON when Polar rejects — never throws', async () => {
    const res = await handleDonateCheckout(req('amount=10'), env, {
      fetchImpl: mock(
        async () => new Response('{"detail":"bad"}', { status: 422 })
      ),
    })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'polar_error', status: 422 })
  })

  test('router wires GET /checkout/donate and rejects POST', async () => {
    const bad = await worker.fetch(req('amount=nope'), env)
    expect(bad.status).toBe(400)
    const post = await worker.fetch(req('amount=10', 'POST'), env)
    expect(post.status).toBe(405)
  })
})

describe('donateSuccessUrl', () => {
  test('always embeds the Polar {CHECKOUT_ID} placeholder', () => {
    expect(donateSuccessUrl('https://chmonitor.dev')).toContain('{CHECKOUT_ID}')
  })
})
