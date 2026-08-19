/**
 * WHY: POST /api/v1/charts/batch must reject unknown grouping ids at the
 * HTTP boundary so a crafted body cannot execute an arbitrary name list.
 */

import { describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({
  env: {
    CLICKHOUSE_HOST: 'http://localhost:8123',
    CLICKHOUSE_USER: 'default',
    CLICKHOUSE_PASSWORD: '',
  },
}))

mock.module('@/lib/feature-permissions/server', () => ({
  authorizeFeatureRequest: async () => null,
  isAnonymousPublicReadRequest: async () => false,
}))

mock.module('@/lib/cloud/reject-demo-host', () => ({
  isDemoHostBlockedForRequest: async () => false,
}))

const { handler } = await import('../batch')

describe('POST /api/v1/charts/batch', () => {
  test('unknown grouping id → 400', async () => {
    const response = await handler(
      new Request('http://localhost/api/v1/charts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupingId: 'not-a-group', hostId: 0 }),
      })
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as {
      success: boolean
      error: { message: string }
    }
    expect(body.success).toBe(false)
    expect(body.error.message).toContain('Unknown chart grouping')
  })

  test('invalid hostId → 400', async () => {
    const response = await handler(
      new Request('http://localhost/api/v1/charts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupingId: 'insights-stats', hostId: -1 }),
      })
    )
    expect(response.status).toBe(400)
  })
})
