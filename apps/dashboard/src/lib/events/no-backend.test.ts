/**
 * Alerts on a deployment with no metadata DB are valid (config-only targets
 * still work): `emitInstanceEvent` must return quietly because no webhook
 * subscriber can exist without a backend. A REAL store failure (the D1 binding
 * exists but the query throws) must still be logged at error.
 */

import { installEventsPlatformMock } from './__tests__/platform-mock'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

let fakeDb: unknown
installEventsPlatformMock(() => fakeDb)

const { emitInstanceEvent } = await import('./outbound-bus')
const { listInstanceScopedSubscriptionsForEvent } = await import(
  './subscription-store'
)

const evt = {
  id: 'evt-1',
  type: 'alert.fired' as const,
  occurred_at: new Date(1_700_000_001_000).toISOString(),
  data: { rule: 'disk' },
}

let errorSpy: ReturnType<typeof spyOn<Console, 'error'>>

beforeEach(() => {
  fakeDb = undefined
  errorSpy = spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

describe('instance events without a metadata DB', () => {
  test('no backend: no subscribers, no throw', async () => {
    expect(
      await listInstanceScopedSubscriptionsForEvent('alert.fired')
    ).toEqual([])
  })

  test('no backend: emitInstanceEvent returns quietly with no error log', async () => {
    await emitInstanceEvent(evt)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  test('real store failure: still throws STORAGE_ERROR and is logged at error', async () => {
    fakeDb = {
      prepare: () => ({
        all: async () => {
          throw new Error('d1 exploded')
        },
      }),
    }
    await expect(
      listInstanceScopedSubscriptionsForEvent('alert.fired')
    ).rejects.toMatchObject({
      name: 'WebhookSubscriptionStoreError',
      code: 'STORAGE_ERROR',
    })

    await emitInstanceEvent(evt)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
      '[events] emitInstanceEvent failed'
    )
  })
})
