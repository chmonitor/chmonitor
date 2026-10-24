/**
 * A throw before the handler body can respond (host resolution) must become
 * a structured JSON 500, not an unstructured crash.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

mock.module('@/lib/api/server-env', () => ({
  bridgeClickHouseEnv: mock(() => undefined),
}))

import * as realMerged from '@/lib/compare/merged-diff-hosts'

mock.module('@/lib/compare/merged-diff-hosts', () => ({
  ...realMerged,
  resolveMergedDiffHosts: mock(async () => {
    throw new Error('host resolution exploded')
  }),
}))

type Handler = (ctx: { request: Request }) => Promise<Response>

const { Route } = await import('../settings-diff')
const handlers = (
  Route.options.server as { handlers: { GET: Handler; POST: Handler } }
).handlers

describe('/api/v1/settings-diff internal errors', () => {
  for (const method of ['GET', 'POST'] as const) {
    test(`${method}: resolveMergedDiffHosts rejection returns JSON 500`, async () => {
      const res = await handlers[method]({
        request: new Request('http://x/api/v1/settings-diff', { method }),
      })
      expect(res.status).toBe(500)
      expect(res.headers.get('content-type')).toContain('application/json')
      const body = (await res.json()) as { success: boolean }
      expect(body.success).toBe(false)
    })
  }
})

afterAll(() => {
  mock.restore()
})
