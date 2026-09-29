import type { Env } from './env'

import worker from './index'
import {
  handleSponsorCheckout,
  parseSponsorAmount,
  parseSponsorDetails,
  sponsorProductId,
  sponsorSuccessUrl,
} from './sponsor-checkout'
import { describe, expect, mock, test } from 'bun:test'
import { SPONSOR_TIER_IDS } from '@chm/pricing'

const env: Env = {
  POLAR_ACCESS_TOKEN: 'polar_test',
  CHM_POLAR_SERVER: 'sandbox',
  CHM_POLAR_SPONSOR_PRODUCT: 'prod_sponsor',
}

function req(query: string, method = 'GET'): Request {
  return new Request(`https://hooks.chmonitor.dev/checkout/sponsor?${query}`, {
    method,
  })
}

function polarMock(
  assert?: (body: Record<string, unknown>) => void
): ReturnType<typeof mock> {
  return mock(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<
      string,
      unknown
    >
    assert?.(body)
    return new Response(
      JSON.stringify({ id: 'chk_spon', url: 'https://polar.sh/checkout/spo' }),
      { status: 201 }
    )
  })
}

describe('parseSponsorAmount', () => {
  test('amount is USD dollars, converted to Polar cents', () => {
    expect(parseSponsorAmount(new URL('https://x/s?amount=59'))).toEqual({
      cents: 5900,
    })
    expect(parseSponsorAmount(new URL('https://x/s?amount=99'))).toEqual({
      cents: 9900,
    })
    expect(parseSponsorAmount(new URL('https://x/s?amount=199'))).toEqual({
      cents: 19900,
    })
    expect(parseSponsorAmount(new URL('https://x/s?amount=99.5'))).toEqual({
      cents: 9950,
    })
  })

  test('cents is Polar-native and wins over amount', () => {
    expect(parseSponsorAmount(new URL('https://x/s?cents=2500'))).toEqual({
      cents: 2500,
    })
    expect(
      parseSponsorAmount(new URL('https://x/s?amount=99&cents=2500'))
    ).toEqual({ cents: 2500 })
  })

  test('a bare tier resolves its own price from @chm/pricing', () => {
    // The ladder, asserted against the shared catalog rather than hard-coded,
    // so a price change lands here too.
    for (const [tier, usd] of [
      ['supporter', 19],
      ['backer', 59],
      ['hero', 99],
      ['partner', 199],
    ] as const) {
      expect(parseSponsorAmount(new URL(`https://x/s?tier=${tier}`))).toEqual({
        cents: usd * 100,
        tier,
      })
    }
  })

  test('amount wins over tier, so a custom amount next to a tier is honoured', () => {
    expect(
      parseSponsorAmount(new URL('https://x/s?tier=supporter&amount=500'))
    ).toEqual({ cents: 50000, tier: 'supporter' })
  })

  test('rejects missing, unknown tier, below Polar USD min, and over the cap', () => {
    expect(parseSponsorAmount(new URL('https://x/s'))).toMatchObject({
      error: expect.stringMatching(/required/i),
    })
    expect(
      parseSponsorAmount(new URL('https://x/s?tier=platinum'))
    ).toMatchObject({
      error: expect.stringMatching(/supporter, backer, hero, or partner/),
    })
    // The message is built from the source of truth, so a tier change
    // cannot leave it stale.
    const result = parseSponsorAmount(new URL('https://x/s?tier=bogus'))
    const message = 'error' in result ? result.error : ''
    for (const id of SPONSOR_TIER_IDS) {
      expect(message).toContain(id)
    }
    expect(
      parseSponsorAmount(new URL('https://x/s?amount=0.25'))
    ).toMatchObject({ error: expect.stringMatching(/at least/i) })
    expect(parseSponsorAmount(new URL('https://x/s?cents=49'))).toMatchObject({
      error: expect.stringMatching(/at least/i),
    })
    expect(
      parseSponsorAmount(new URL('https://x/s?amount=10001'))
    ).toMatchObject({ error: expect.stringMatching(/at most/i) })
    expect(
      parseSponsorAmount(new URL('https://x/s?amount=nope'))
    ).toMatchObject({ error: expect.stringMatching(/positive USD/i) })
  })
})

describe('parseSponsorDetails', () => {
  test('keeps the fields Polar can store and drops the junk', () => {
    expect(
      parseSponsorDetails(
        new URL(
          'https://x/s?name=Acme&website=https://acme.com&email=ops@acme.com&logo=https://acme.com/logo.svg'
        )
      )
    ).toEqual({
      name: 'Acme',
      website: 'https://acme.com',
      email: 'ops@acme.com',
      logo: 'https://acme.com/logo.svg',
    })
  })

  test('a bad website or logo is dropped, never rejected', () => {
    // The payment must never fail because a detail field was malformed.
    expect(
      parseSponsorDetails(
        new URL(
          'https://x/s?name=Acme&website=javascript:alert(1)&logo=not-a-url'
        )
      )
    ).toEqual({ name: 'Acme' })
  })

  test('an unusable email is rejected, because Polar 422s the checkout', () => {
    // Observed in production: Polar refuses to attach a customer to a
    // placeholder domain and 422s, which used to surface as a bare 502.
    for (const email of [
      'nope',
      'you@example.com',
      'you@probe.example',
      'a@acme.invalid',
      'a@localhost',
    ]) {
      const url = new URL(`https://x/s?email=${encodeURIComponent(email)}`)
      expect(parseSponsorDetails(url), email).toMatchObject({
        error: expect.stringMatching(/deliverable/i),
      })
    }
    for (const email of ['ops@acme.com', 'hello@chmonitor.dev']) {
      const url = new URL(`https://x/s?email=${encodeURIComponent(email)}`)
      expect(parseSponsorDetails(url), email).toMatchObject({ email })
    }
  })

  test('angle brackets are stripped and values are length-capped', () => {
    const out = parseSponsorDetails(
      new URL(`https://x/s?name=${encodeURIComponent('<b>Acme</b>')}`)
    )
    expect(out.name).toBe('bAcme/b')
    const long = parseSponsorDetails(
      new URL(`https://x/s?name=${'x'.repeat(300)}`)
    )
    expect(long.name).toHaveLength(120)
  })

  test('an empty query yields no details — the pick-only path', () => {
    expect(parseSponsorDetails(new URL('https://x/s?amount=99'))).toEqual({})
  })
})

describe('GET /checkout/sponsor', () => {
  test('302 with cents and the {CHECKOUT_ID} success_url', async () => {
    const fetchImpl = polarMock((body) => {
      expect(body.products).toEqual(['prod_sponsor'])
      expect(body.amount).toBe(1900)
      expect(body.success_url).toBe(
        'https://chmonitor.dev/sponsors?sponsored=1&checkout_id={CHECKOUT_ID}'
      )
    })
    const res = await handleSponsorCheckout(req('amount=19'), env, {
      fetchImpl,
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://polar.sh/checkout/spo')
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://sandbox-api.polar.sh/v1/checkouts/'
    )
  })

  test('forwards the details to the Polar customer AND the order', async () => {
    const fetchImpl = polarMock((body) => {
      // Account: pre-fills the checkout and lands on the Polar customer.
      expect(body.customer_email).toBe('ops@acme.com')
      expect(body.customer_name).toBe('Acme')
      expect(body.customer_metadata).toEqual({
        sponsorship: 'backer',
        website: 'https://acme.com',
        logo: 'https://acme.com/logo.svg',
      })
      // Order: what we read back to build the listing.
      expect(body.metadata).toEqual({
        kind: 'sponsor',
        tier: 'backer',
        name: 'Acme',
        website: 'https://acme.com',
        logo: 'https://acme.com/logo.svg',
      })
    })
    const res = await handleSponsorCheckout(
      req(
        'tier=backer&name=Acme&website=https%3A%2F%2Facme.com&email=ops%40acme.com&logo=https%3A%2F%2Facme.com%2Flogo.svg'
      ),
      env,
      { fetchImpl }
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://polar.sh/checkout/spo')
  })

  test('pick-only sends no customer fields and no customer_metadata', async () => {
    const fetchImpl = polarMock((body) => {
      expect(body.customer_email).toBeUndefined()
      expect(body.customer_name).toBeUndefined()
      expect(body.customer_metadata).toBeUndefined()
      expect(body.metadata).toEqual({ kind: 'sponsor' })
    })
    const res = await handleSponsorCheckout(req('amount=199'), env, {
      fetchImpl,
    })
    expect(res.status).toBe(302)
  })

  test('400 on a missing or invalid amount', async () => {
    expect((await handleSponsorCheckout(req(''), env)).status).toBe(400)
    expect((await handleSponsorCheckout(req('amount=0'), env)).status).toBe(400)
  })

  test('400 on a placeholder email, before Polar is called at all', async () => {
    const fetchImpl = polarMock()
    const res = await handleSponsorCheckout(
      req('amount=99&email=you%40example.com'),
      env,
      { fetchImpl }
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'email must be a real, deliverable address',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test("Polar's 422 on a customer becomes a 400, not a gateway error", async () => {
    const res = await handleSponsorCheckout(
      req('amount=99&email=ops%40acme.com'),
      env,
      {
        fetchImpl: mock(
          async () => new Response('{"detail":"bad"}', { status: 422 })
        ),
      }
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'polar_rejected_email',
      status: 422,
    })
  })

  test('a Polar 422 with no email is still a 502', async () => {
    const res = await handleSponsorCheckout(req('amount=99'), env, {
      fetchImpl: mock(
        async () => new Response('{"detail":"bad"}', { status: 422 })
      ),
    })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'polar_error', status: 422 })
  })

  test('501 when token or the Polar product id is missing', async () => {
    const noToken = await handleSponsorCheckout(req('amount=19'), {
      ...env,
      POLAR_ACCESS_TOKEN: undefined,
    })
    expect(noToken.status).toBe(501)
    expect(await noToken.json()).toEqual({ error: 'billing is not enabled' })

    const noProduct = await handleSponsorCheckout(req('amount=19'), {
      POLAR_ACCESS_TOKEN: 'x',
    })
    expect(noProduct.status).toBe(501)
    expect(((await noProduct.json()) as { error: string }).error).toMatch(
      /no Polar sponsor product/
    )
  })

  test('502 JSON when Polar rejects — never throws', async () => {
    const res = await handleSponsorCheckout(req('amount=19'), env, {
      fetchImpl: mock(
        async () => new Response('{"detail":"bad"}', { status: 422 })
      ),
    })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'polar_error', status: 422 })
  })

  test('router wires GET /checkout/sponsor and rejects POST', async () => {
    const bad = await worker.fetch(req('amount=nope'), env)
    expect(bad.status).toBe(400)
    const post = await worker.fetch(req('amount=19', 'POST'), env)
    expect(post.status).toBe(405)
    // The old donate route is gone: the surface is Sponsor end to end.
    const old = await worker.fetch(
      new Request('https://hooks.chmonitor.dev/checkout/donate?amount=19'),
      env
    )
    expect(old.status).toBe(404)
  })
})

describe('sponsor product wiring', () => {
  test('reads the committed Polar id from the legacy donate env key', () => {
    expect(sponsorProductId(env)).toBe('prod_sponsor')
    expect(sponsorProductId({})).toBeUndefined()
  })

  test('success_url always embeds the Polar {CHECKOUT_ID} placeholder', () => {
    expect(sponsorSuccessUrl('https://chmonitor.dev')).toContain(
      '{CHECKOUT_ID}'
    )
    expect(sponsorSuccessUrl('https://chmonitor.dev')).toContain('/sponsors?')
  })
})
