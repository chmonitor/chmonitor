/**
 * Custom alert rules on a deployment with no metadata DB: the GET list answers
 * 501 (the rule builder renders that as "not available on this deployment")
 * WITHOUT an error log; a write still fails loudly, and the message names
 * DATABASE_URL before D1.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test'
import { installHealthPlatformMock } from '@/lib/health/__tests__/platform-mock'

mock.module('@/lib/auth/api-guard', () => ({
  isAuthenticatedRequest: async () => true,
}))
mock.module('@/lib/health/custom-rules-auth', () => ({
  resolveCustomRuleOwnerId: async () => 'oss',
}))
installHealthPlatformMock(() => undefined)

const { noBackendMessage } = await import('@/lib/health/no-backend-message')

type Handlers = Record<string, (ctx: { request: Request }) => Promise<Response>>
const { Route } = (await import('./custom-rules')) as unknown as {
  Route: { options: { server: { handlers: Handlers } } }
}
const handlers = Route.options.server.handlers

const SAVED = {
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_URL: process.env.POSTGRES_URL,
  POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL,
}
let errorSpy: ReturnType<typeof spyOn<Console, 'error'>>

beforeEach(() => {
  delete process.env.DATABASE_URL
  delete process.env.POSTGRES_URL
  delete process.env.POSTGRES_PRISMA_URL
  errorSpy = spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  errorSpy.mockRestore()
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('custom-rules without a state backend', () => {
  test('GET: 501 NOT_CONFIGURED shape, no error log', async () => {
    const res = await handlers.GET({
      request: new Request('http://x/api/v1/health/custom-rules'),
    })
    expect(res.status).toBe(501)
    const body = (await res.json()) as {
      success: boolean
      error: { message: string }
    }
    expect(body.success).toBe(false)
    expect(body.error.message).toContain('DATABASE_URL')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  test('POST: still 501 and logged at error, DATABASE_URL named before D1', async () => {
    const res = await handlers.POST({
      request: new Request('http://x/api/v1/health/custom-rules', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Mutations',
          metric: 'active-mutations',
          op: '>',
          warning: 1,
          critical: 5,
        }),
        headers: { 'content-type': 'application/json' },
      }),
    })
    expect(res.status).toBe(501)
    const body = (await res.json()) as { error: { message: string } }
    const msg = body.error.message
    expect(msg.indexOf('DATABASE_URL')).toBeGreaterThanOrEqual(0)
    expect(msg.indexOf('DATABASE_URL')).toBeLessThan(
      msg.indexOf('CHM_CLOUD_D1')
    )
    expect(msg).toBe(noBackendMessage('Custom alert rules'))
    expect(msg).not.toContain('wrangler')
    expect(errorSpy).toHaveBeenCalled()
  })
})
