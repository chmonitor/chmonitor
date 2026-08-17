import { beforeEach, describe, expect, mock, test } from 'bun:test'

let checkoutsCreate = mock(async (_args: unknown) => ({
  url: 'https://polar.sh/checkout/lic',
}))
let billingOn = true
const products: Record<string, string> = {
  'team/yearly': 'prod_team_y',
  'team/lifetime': 'prod_team_l',
  'unlimited/yearly': 'prod_unl_y',
  'unlimited/lifetime': 'prod_unl_l',
}

mock.module('@/lib/billing/polar-config', () => ({
  isBillingConfigured: () => billingOn,
  isPaidLicenseId: (v: string) => v === 'team' || v === 'unlimited',
  licenseProductIdFor: (sku: string, term: string) =>
    products[`${sku}/${term}`] ?? null,
  getPolarClient: () => ({
    checkouts: { create: (args: unknown) => checkoutsCreate(args) },
  }),
}))

const { __handleGetForTests: handleGet } = await import('./license-checkout')

function makeRequest(query: string): Request {
  return new Request(
    `https://dash.example.com/api/v1/billing/license-checkout?${query}`
  )
}

beforeEach(() => {
  billingOn = true
  checkoutsCreate = mock(async () => ({ url: 'https://polar.sh/checkout/lic' }))
})

describe('GET /api/v1/billing/license-checkout', () => {
  test('redirects to Polar with the Team yearly product', async () => {
    const res = await handleGet({
      request: makeRequest('sku=team&term=yearly'),
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://polar.sh/checkout/lic')
    expect(checkoutsCreate.mock.calls[0]?.[0]).toMatchObject({
      products: ['prod_team_y'],
      successUrl:
        'https://chmonitor.dev/license/register?sku=team&term=yearly&paid=1',
      metadata: { kind: 'selfhost-license', sku: 'team', term: 'yearly' },
    })
  })

  test('lifetime uses the one-time product', async () => {
    await handleGet({
      request: makeRequest('sku=unlimited&term=lifetime'),
    })
    expect(checkoutsCreate.mock.calls[0]?.[0]).toMatchObject({
      products: ['prod_unl_l'],
    })
  })

  test('400 on bad sku or term', async () => {
    expect(
      (await handleGet({ request: makeRequest('sku=pro&term=yearly') })).status
    ).toBe(400)
    expect(
      (await handleGet({ request: makeRequest('sku=team&term=monthly') }))
        .status
    ).toBe(400)
  })

  test('501 when Polar is off or product unset', async () => {
    billingOn = false
    expect(
      (await handleGet({ request: makeRequest('sku=team&term=yearly') })).status
    ).toBe(501)
    billingOn = true
    expect(
      (await handleGet({ request: makeRequest('sku=team&term=yearly') })).status
    ).not.toBe(501)
  })
})
