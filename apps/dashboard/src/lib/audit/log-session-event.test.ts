/**
 * Unit tests for log-session-event.ts — the session-scoped logEvent wrapper
 * used by billing/connection routes (as opposed to webhook handlers, which
 * already have an org id from the payload).
 *
 * Both collaborators are mocked at their LEAF specifiers (`@/lib/billing/
 * billing-owner` and `./logEvent`), never the `@/lib/audit` barrel — a barrel
 * mock here would shadow `listAuditLogs`/CSV exports for export.test.ts when
 * both files run in the same `bun test src/ --isolate` process (see the
 * cross-file mock.module registration notes in webhooks/clerk.test.ts).
 */

import type { BillingOwner } from '@/lib/billing/billing-owner'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

let resolveBillingOwnerImpl = mock(
  async (): Promise<BillingOwner> => ({
    type: 'org',
    id: 'org_1',
  })
)
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: () => resolveBillingOwnerImpl(),
}))

let logEventImpl = mock(async (_e: unknown) => {})
mock.module('./logEvent', () => ({
  logEvent: (e: unknown) => logEventImpl(e),
}))

const { logSessionEvent } = await import('./log-session-event')

beforeEach(() => {
  resolveBillingOwnerImpl = mock(
    async (): Promise<BillingOwner> => ({
      type: 'org',
      id: 'org_1',
    })
  )
  logEventImpl = mock(async () => {})
})

describe('logSessionEvent', () => {
  test('resolves the session org id and forwards the event to logEvent', async () => {
    await logSessionEvent({
      event: 'connection.created',
      action: 'create',
      result: 'success',
      resource: 'conn_1',
      userId: 'user_1',
    })

    expect(logEventImpl).toHaveBeenCalledTimes(1)
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_1',
      event: 'connection.created',
      action: 'create',
      result: 'success',
      resource: 'conn_1',
      userId: 'user_1',
    })
  })

  test('no-ops when the session has no active org (free/user-scoped account)', async () => {
    resolveBillingOwnerImpl = mock(async () => ({
      type: 'user' as const,
      id: 'user_1',
    }))

    await logSessionEvent({
      event: 'connection.created',
      action: 'create',
      result: 'success',
    })

    expect(logEventImpl).not.toHaveBeenCalled()
  })

  test('no-ops (never throws) when org resolution itself fails', async () => {
    resolveBillingOwnerImpl = mock(async () => {
      throw new Error('unauthorized')
    })

    await expect(
      logSessionEvent({ event: 'x', action: 'create', result: 'success' })
    ).resolves.toBeUndefined()
    expect(logEventImpl).not.toHaveBeenCalled()
  })
})
