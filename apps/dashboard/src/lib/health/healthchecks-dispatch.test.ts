import { dispatchHealthchecks } from './healthchecks-dispatch'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const SAVED = 'https://hc.example.com/ping-uuid'
const resolvePublic = async () => ['93.184.216.34']

let calls: Array<{ url: string; init?: RequestInit }> = []
const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(input), init })
  return new Response('ok', { status: 200 })
}) as typeof fetch

const savedEnv = process.env.HEALTH_ALERT_HEALTHCHECKS_URL

beforeEach(() => {
  calls = []
  delete process.env.HEALTH_ALERT_HEALTHCHECKS_URL
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env.HEALTH_ALERT_HEALTHCHECKS_URL
  else process.env.HEALTH_ALERT_HEALTHCHECKS_URL = savedEnv
})

describe('dispatchHealthchecks', () => {
  test('saved URL is sent with redirects refused', async () => {
    const ok = await dispatchHealthchecks(SAVED, 'alert', {
      fetchImpl,
      resolveHostAddresses: resolvePublic,
    })
    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(SAVED)
    expect(calls[0].init?.redirect).toBe('error')
  })

  test('recovery pings the /fail path', async () => {
    await dispatchHealthchecks(`${SAVED}/`, 'recovery', {
      fetchImpl,
      resolveHostAddresses: resolvePublic,
    })
    expect(calls[0].url).toBe(`${SAVED}/fail`)
  })

  for (const blocked of [
    'https://127.0.0.1/ping',
    'https://169.254.169.254/latest/meta-data',
  ]) {
    test(`saved URL ${blocked} is not fetched`, async () => {
      const ok = await dispatchHealthchecks(blocked, 'alert', { fetchImpl })
      expect(ok).toBe(false)
      expect(calls).toHaveLength(0)
    })
  }

  test('saved URL resolving to a private address is not fetched', async () => {
    const ok = await dispatchHealthchecks(SAVED, 'alert', {
      fetchImpl,
      resolveHostAddresses: async () => ['10.0.0.5'],
    })
    expect(ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  test('env-configured URL is trusted and may follow redirects', async () => {
    const envUrl = 'http://hc.internal.lan/ping-uuid'
    process.env.HEALTH_ALERT_HEALTHCHECKS_URL = envUrl
    const ok = await dispatchHealthchecks(envUrl, 'alert', {
      fetchImpl,
      resolveHostAddresses: async () => ['10.0.0.5'],
    })
    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].init?.redirect).toBeUndefined()
  })

  test('a refused redirect is reported as failure, not thrown', async () => {
    const throwing = (async () => {
      throw new TypeError('redirect mode is set to error')
    }) as unknown as typeof fetch
    const ok = await dispatchHealthchecks(SAVED, 'alert', {
      fetchImpl: throwing,
      resolveHostAddresses: resolvePublic,
    })
    expect(ok).toBe(false)
  })
})
