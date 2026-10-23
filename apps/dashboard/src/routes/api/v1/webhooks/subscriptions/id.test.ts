/**
 * PATCH /api/v1/webhooks/subscriptions/$id validates `details` like POST: a
 * non-boolean is a 400, never silently ignored. The 400 fires before any
 * store or auth access, so no subscription store is touched.
 */

import { afterAll, describe, expect, mock, test } from 'bun:test'

const realServerFeature = await import('@/lib/events/server-feature')
mock.module('@/lib/events/server-feature', () => ({
  ...realServerFeature,
  getWebhookSubscriptionsServerConfig: () => ({ enabled: true }),
}))
afterAll(() => {
  mock.module('@/lib/events/server-feature', () => realServerFeature)
})

const { Route } = await import('./$id')

type PatchHandler = (ctx: {
  request: Request
  params: { id: string }
}) => Promise<Response>

function patch(body: unknown): Promise<Response> {
  const handler = (
    Route as unknown as {
      options: { server: { handlers: { PATCH: PatchHandler } } }
    }
  ).options.server.handlers.PATCH
  return handler({
    request: new Request('http://localhost/api/v1/webhooks/subscriptions/s1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    params: { id: 's1' },
  })
}

describe('PATCH /api/v1/webhooks/subscriptions/$id details', () => {
  test.each([
    'yes',
    1,
    null,
    {},
  ])('rejects non-boolean details %p with 400', async (details) => {
    const res = await patch({ details })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('expected a boolean')
  })
})
