/**
 * #3741: the table list and filter-options routes reject a malformed host id
 * with a 400 instead of truncating it (`1.5` -> 1, `1abc` -> 1) via parseInt.
 */
import { describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

const { Route: listRoute } = await import('@/routes/api/v1/tables/index')
const { Route: optionsRoute } = await import(
  '@/routes/api/v1/tables/$name/filter-options'
)

type Handler = (ctx: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

const list = (listRoute as any).options.server.handlers.GET as Handler
const options = (optionsRoute as any).options.server.handlers.GET as Handler

describe.each([
  '1.5',
  '1abc',
  '-1',
  '',
  ' 1',
  '1e2',
  '0x1',
])('hostId=%j', (hostId) => {
  test('tables list returns 400', async () => {
    const res = await list({
      request: new Request(
        `http://x/api/v1/tables?hostId=${encodeURIComponent(hostId)}`
      ),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { success: boolean }
    expect(body.success).toBe(false)
  })

  test('filter-options returns 400', async () => {
    const res = await options({
      request: new Request(
        `http://x/api/v1/tables/history-queries/filter-options?key=user&hostId=${encodeURIComponent(hostId)}`
      ),
      params: { name: 'history-queries' },
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { success: boolean }
    expect(body.success).toBe(false)
  })
})
