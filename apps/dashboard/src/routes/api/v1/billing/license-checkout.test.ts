import { describe, expect, test } from 'bun:test'

const { __handleGetForTests: handleGet } = await import('./license-checkout')

function makeRequest(query: string): Request {
  return new Request(
    `https://dash.example.com/api/v1/billing/license-checkout?${query}`
  )
}

describe('GET /api/v1/billing/license-checkout', () => {
  test('302 to cloud-hooks checkout (dash never calls Polar)', async () => {
    const res = await handleGet({
      request: makeRequest('sku=team&term=yearly'),
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://hooks.chmonitor.dev/checkout/license?sku=team&term=yearly'
    )
  })

  test('lifetime unlimited bounces the same way', async () => {
    const res = await handleGet({
      request: makeRequest('sku=unlimited&term=lifetime'),
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(
      'https://hooks.chmonitor.dev/checkout/license?sku=unlimited&term=lifetime'
    )
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
})
