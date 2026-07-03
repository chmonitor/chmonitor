/**
 * Route test for GET /api/v1/health/history.
 *
 * Mocks `@/lib/health/alert-history-store` directly (the store's own SQL /
 * fail-open semantics are covered by `alert-history-store.test.ts`) so this
 * file proves the ROUTE's contract: hostId/day/limit are parsed from the
 * query string and forwarded to `queryAlertEvents`, invalid params 400
 * instead of reaching the store, and the response shapes `{ success, events
 * }`. Mirrors the `Route.options.server.handlers` extraction pattern used by
 * `routes/api/v1/__tests__/actions.test.ts`.
 */

import type { AlertEventRecord } from '@/lib/health/alert-history-store'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

const mockQueryAlertEvents = mock(async () => [] as AlertEventRecord[])

mock.module('@/lib/health/alert-history-store', () => ({
  queryAlertEvents: mockQueryAlertEvents,
}))

const { Route } = await import('./history')

type GetHandler = (ctx: { request: Request }) => Promise<Response>

/**
 * Extracts the GET handler from a TanStack Start server route. See
 * `actions.test.ts`'s `getPostHandler` for why the cast is needed —
 * `Route.options.server.handlers` is a union TypeScript can't narrow further.
 */
function getGetHandler(route: { options: { server?: unknown } }): GetHandler {
  const handlers = (route.options.server as { handlers?: { GET?: GetHandler } })
    ?.handlers
  const fn = handlers?.GET
  if (!fn) throw new Error('Route has no GET handler')
  return fn
}

const handler = getGetHandler(Route)

function makeRequest(query: string): Request {
  return new Request(`http://localhost/api/v1/health/history${query}`)
}

const sampleEvent = (
  over: Partial<AlertEventRecord> = {}
): AlertEventRecord => ({
  id: 'evt-1',
  eventTime: '2026-07-01T12:00:00.000Z',
  hostId: 0,
  hostLabel: 'prod-ch',
  rule: 'disk-usage',
  severity: 'critical',
  prevSeverity: 'warning',
  decisionKind: 'escalated',
  delivered: true,
  error: null,
  value: 97.5,
  channel: 'slack',
  ...over,
})

beforeEach(() => {
  mockQueryAlertEvents.mockClear()
  mockQueryAlertEvents.mockImplementation(async () => [])
})

describe('GET /api/v1/health/history', () => {
  test('with no query params, forwards an all-undefined filter and returns events', async () => {
    mockQueryAlertEvents.mockImplementation(async () => [sampleEvent()])

    const response = await handler({ request: makeRequest('') })
    expect(response.status).toBe(200)

    const body = (await response.json()) as {
      success: boolean
      events: AlertEventRecord[]
    }
    expect(body.success).toBe(true)
    expect(body.events).toEqual([sampleEvent()])
    expect(mockQueryAlertEvents).toHaveBeenCalledWith({
      hostId: undefined,
      day: undefined,
      limit: undefined,
    })
  })

  test('parses hostId, day, and limit and forwards them to the store', async () => {
    const response = await handler({
      request: makeRequest('?hostId=2&day=2026-07-01&limit=25'),
    })
    expect(response.status).toBe(200)
    expect(mockQueryAlertEvents).toHaveBeenCalledWith({
      hostId: 2,
      day: '2026-07-01',
      limit: 25,
    })
  })

  test('rejects a non-integer hostId with 400 without querying the store', async () => {
    const response = await handler({ request: makeRequest('?hostId=abc') })
    expect(response.status).toBe(400)
    expect(mockQueryAlertEvents).not.toHaveBeenCalled()
  })

  test('rejects a negative hostId with 400', async () => {
    const response = await handler({ request: makeRequest('?hostId=-1') })
    expect(response.status).toBe(400)
    expect(mockQueryAlertEvents).not.toHaveBeenCalled()
  })

  test('rejects a malformed day with 400 without querying the store', async () => {
    const response = await handler({ request: makeRequest('?day=07-01-2026') })
    expect(response.status).toBe(400)
    expect(mockQueryAlertEvents).not.toHaveBeenCalled()
  })

  test('rejects a non-positive limit with 400', async () => {
    const response = await handler({ request: makeRequest('?limit=0') })
    expect(response.status).toBe(400)
    expect(mockQueryAlertEvents).not.toHaveBeenCalled()
  })
})
