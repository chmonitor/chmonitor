/**
 * Polar webhook handler — signature rejection + event notification wiring.
 *
 * `validateEvent` is injected so we can drive the signature/success paths
 * without a real Polar signature (mirrors the plan's "mock validateEvent"
 * requirement). `applyDeps` is injected so persistence is stubbed here.
 */

import type { ApplySubscriptionDeps } from '@chm/billing-webhook-core'
import type { Env } from './env'

import { handlePolarWebhook, type ValidateEventFn } from './webhook'
import { beforeEach, describe, expect, mock, test } from 'bun:test'

const env: Env = {
  POLAR_WEBHOOK_SECRET: 'whsec_test',
  CHM_POLAR_PRODUCT_PRO_MONTHLY: 'prod_pro',
}

function req(body = '{}') {
  return new Request('https://hooks.chmonitor.dev/webhooks/polar', {
    method: 'POST',
    body,
    headers: { 'webhook-signature': 'sig' },
  })
}

function stubDeps(overrides: Partial<ApplySubscriptionDeps> = {}) {
  return {
    planForProductId: () => ({
      planId: 'pro' as const,
      period: 'monthly' as const,
    }),
    ensureOrgForUser: async () => null,
    rekeyCustomerToOrg: async () => {},
    upsertSubscription: mock(async () => {}),
    invalidateNegativeCache: () => {},
    onUpgradeCompleted: async () => {},
    logBillingAudit: async () => {},
    logInfo: () => {},
    logError: () => {},
    ...overrides,
  } as ApplySubscriptionDeps
}

let notify: ReturnType<typeof mock>

beforeEach(() => {
  notify = mock(async () => true)
})

describe('signature verification', () => {
  test('a WebhookVerificationError → 403 and a signature_failure notification', async () => {
    const validateEvent: ValidateEventFn = () => {
      throw Object.assign(new Error('bad sig'), {
        name: 'WebhookVerificationError',
      })
    }
    const res = await handlePolarWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      validateEvent,
    })
    expect(res.status).toBe(403)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]?.[0]).toBe('signature_failure')
  })

  test('a non-signature parse error → 400 and no notification', async () => {
    const validateEvent: ValidateEventFn = () => {
      throw new Error('unexpected token')
    }
    const res = await handlePolarWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      validateEvent,
    })
    expect(res.status).toBe(400)
    expect(notify).not.toHaveBeenCalled()
  })

  test('no secret configured → 501', async () => {
    const res = await handlePolarWebhook(
      req(),
      { ...env, POLAR_WEBHOOK_SECRET: undefined },
      {
        notify: (k, t) => notify(k, t),
        validateEvent: () => ({ type: 'x', data: {} }),
      }
    )
    expect(res.status).toBe(501)
  })
})

describe('handled subscription events', () => {
  function event(type: string, data: Record<string, unknown>) {
    const validateEvent: ValidateEventFn = () => ({
      type,
      data,
      timestamp: new Date('2026-01-01T00:00:00Z'),
    })
    return validateEvent
  }

  const subData = {
    id: 'sub_1',
    status: 'active',
    productId: 'prod_pro',
    customerId: 'cus_1',
    customer: { externalId: 'org_x' },
  }

  test('subscription.created → 202, persists, and notifies with the subscription kind', async () => {
    const applyDeps = stubDeps()
    const res = await handlePolarWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      validateEvent: event('subscription.created', subData),
      applyDeps,
    })
    expect(res.status).toBe(202)
    expect(applyDeps.upsertSubscription).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0]?.[0]).toBe('subscription')
  })

  test('a canceled subscription notifies with the cancel kind', async () => {
    const res = await handlePolarWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      validateEvent: event('subscription.updated', {
        ...subData,
        status: 'canceled',
      }),
      applyDeps: stubDeps(),
    })
    expect(res.status).toBe(202)
    expect(notify.mock.calls[0]?.[0]).toBe('cancel')
  })

  test('a past_due subscription notifies with the payment_failure kind', async () => {
    await handlePolarWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      validateEvent: event('subscription.past_due', {
        ...subData,
        status: 'past_due',
      }),
      applyDeps: stubDeps(),
    })
    expect(notify.mock.calls[0]?.[0]).toBe('payment_failure')
  })

  test('an unhandled event type → 202 with no persistence and no notification', async () => {
    const applyDeps = stubDeps()
    const res = await handlePolarWebhook(req(), env, {
      notify: (k, t) => notify(k, t),
      validateEvent: event('checkout.created', subData),
      applyDeps,
    })
    expect(res.status).toBe(202)
    expect(applyDeps.upsertSubscription).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})
