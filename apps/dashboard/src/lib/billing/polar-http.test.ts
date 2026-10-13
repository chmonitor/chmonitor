/**
 * Polar REST client (#3808): snake_case -> camelCase remap and error surfacing.
 * Stubs `globalThis.fetch` only (restored after each test).
 */

import { createPolarHttpClient, PolarHttpError } from './polar-http'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const realFetch = globalThis.fetch
const savedServer = process.env.CHM_POLAR_SERVER
let seen: { url: string; init?: RequestInit }[] = []
let reply: () => Response

beforeEach(() => {
  seen = []
  delete process.env.CHM_POLAR_SERVER
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init })
    return reply()
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  if (savedServer === undefined) delete process.env.CHM_POLAR_SERVER
  else process.env.CHM_POLAR_SERVER = savedServer
})

const client = () => createPolarHttpClient('tok_123')

describe('getStateExternal', () => {
  test('remaps snake_case subscription fields to camelCase', async () => {
    reply = () =>
      Response.json({
        active_subscriptions: [
          {
            product_id: 'prod_1',
            status: 'active',
            current_period_end: '2026-12-01T00:00:00Z',
            cancel_at_period_end: true,
          },
        ],
      })
    const state = await client().customers.getStateExternal({
      externalId: 'user 1',
    })
    expect(state.activeSubscriptions).toEqual([
      {
        productId: 'prod_1',
        status: 'active',
        currentPeriodEnd: '2026-12-01T00:00:00Z',
        cancelAtPeriodEnd: true,
      },
    ])
    expect(seen[0]?.url).toBe(
      'https://sandbox-api.polar.sh/v1/customers/external/user%201/state'
    )
    expect(
      (seen[0]?.init?.headers as Record<string, string>).Authorization
    ).toBe('Bearer tok_123')
  })

  test('production server flag switches the API base', async () => {
    process.env.CHM_POLAR_SERVER = 'production'
    reply = () => Response.json({ active_subscriptions: [] })
    await client().customers.getStateExternal({ externalId: 'u' })
    expect(seen[0]?.url.startsWith('https://api.polar.sh/')).toBe(true)
  })

  test('missing optional fields default safely', async () => {
    reply = () =>
      Response.json({ active_subscriptions: [{ status: 'active' }] })
    const state = await client().customers.getStateExternal({
      externalId: 'u',
    })
    expect(state.activeSubscriptions[0]).toEqual({
      productId: '',
      status: 'active',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    })
  })

  test('404 throws PolarHttpError(ResourceNotFound)', async () => {
    reply = () => new Response('nope', { status: 404 })
    const err = await client()
      .customers.getStateExternal({ externalId: 'u' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PolarHttpError)
    expect((err as PolarHttpError).status).toBe(404)
    expect((err as PolarHttpError).message).toBe('ResourceNotFound')
  })

  test('5xx throws PolarHttpError carrying status and body', async () => {
    reply = () => new Response('upstream down', { status: 503 })
    const err = await client()
      .customers.getStateExternal({ externalId: 'u' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PolarHttpError)
    expect((err as PolarHttpError).status).toBe(503)
    expect((err as PolarHttpError).body).toBe('upstream down')
  })
})

describe('update', () => {
  test('PATCHes external_id (camelCase input -> snake_case wire)', async () => {
    reply = () => new Response(null, { status: 200 })
    await client().customers.update({
      id: 'cus/1',
      customerUpdate: { externalId: 'ext-9' },
    })
    expect(seen[0]?.url).toBe(
      'https://sandbox-api.polar.sh/v1/customers/cus%2F1'
    )
    expect(seen[0]?.init?.method).toBe('PATCH')
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      external_id: 'ext-9',
    })
  })

  test('4xx throws PolarHttpError', async () => {
    reply = () => new Response('bad', { status: 422 })
    const err = await client()
      .customers.update({ id: 'c', customerUpdate: { externalId: 'e' } })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PolarHttpError)
    expect((err as PolarHttpError).status).toBe(422)
  })
})
