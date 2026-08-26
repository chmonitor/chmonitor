import { authorizeCronRequest } from '../authorize-cron'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

describe('authorizeCronRequest', () => {
  const saved = process.env.CRON_SECRET

  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-test-secret'
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved
  })

  test('accepts Authorization: Bearer header', () => {
    const req = new Request('https://x/api/cron/health-sweep', {
      headers: { authorization: 'Bearer cron-test-secret' },
    })
    expect(authorizeCronRequest(req, 'health-sweep')).toBeNull()
  })

  test('rejects ?secret= query param even when value matches', async () => {
    const req = new Request(
      'https://x/api/cron/health-sweep?secret=cron-test-secret'
    )
    const res = authorizeCronRequest(req, 'health-sweep')
    expect(res?.status).toBe(401)
    const body = (await res!.json()) as { error: string }
    expect(body.error).toContain('Query-string cron secrets are not accepted')
  })

  test('returns 503 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    const req = new Request('https://x/api/cron/health-sweep', {
      headers: { authorization: 'Bearer anything' },
    })
    const res = authorizeCronRequest(req, 'health-sweep')
    expect(res?.status).toBe(503)
  })
})
