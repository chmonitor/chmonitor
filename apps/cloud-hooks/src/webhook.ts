/**
 * POST /webhooks/polar — the cloud-hooks Polar receiver.
 *
 * Same contract as the dashboard route (`validateEvent` over the RAW body →
 * 403 on bad signature; 202 on a handled event) but it ALSO notifies the
 * operator over Telegram on every business event and on signature failures.
 * Persistence goes through the shared core so state stays identical to the
 * dashboard's until the endpoint is cut over.
 *
 * Unauthenticated by design — the signature IS the auth.
 */

import type { Env } from './env'
import type { NotifyKind } from './telegram'

import { makeApplyDeps, makePlanForProductId } from './billing-deps'
import {
  type ApplySubscriptionDeps,
  applySubscription as coreApplySubscription,
  type PolarSubscriptionData,
  toUnixSeconds,
} from '@chm/billing-webhook-core'

/** Injected so tests can drive signature rejection without a real signature. */
export type ValidateEventFn = (
  body: string,
  headers: Record<string, string>,
  secret: string
) => { type: string; data: unknown; timestamp?: Date | string | null }

export interface WebhookDeps {
  notify: (kind: NotifyKind, text: string) => Promise<boolean>
  /** Defaults to the real `@polar-sh/sdk/webhooks` validateEvent. */
  validateEvent?: ValidateEventFn
  /** Override the assembled core deps (tests). */
  applyDeps?: ApplySubscriptionDeps
  fetch?: typeof fetch
}

const HANDLED_EVENTS = new Set([
  'subscription.created',
  'subscription.updated',
  'subscription.active',
  'subscription.canceled',
  'subscription.uncanceled',
  'subscription.revoked',
  'subscription.past_due',
])

/** Map a subscription event to its notification kind. */
function kindForEvent(eventType: string, status: string): NotifyKind {
  if (eventType === 'subscription.created') return 'subscription'
  if (status === 'canceled' || status === 'revoked') return 'cancel'
  if (status === 'past_due') return 'payment_failure'
  return 'plan_change'
}

async function defaultValidateEvent(
  body: string,
  headers: Record<string, string>,
  secret: string
): Promise<ReturnType<ValidateEventFn>> {
  const { validateEvent } = await import('@polar-sh/sdk/webhooks')
  return validateEvent(body, headers, secret) as ReturnType<ValidateEventFn>
}

export async function handlePolarWebhook(
  request: Request,
  env: Env,
  deps: WebhookDeps
): Promise<Response> {
  const secret = env.POLAR_WEBHOOK_SECRET
  if (!secret) {
    return Response.json(
      { error: 'Billing webhook not configured' },
      { status: 501 }
    )
  }

  const body = await request.text()
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  let event: ReturnType<ValidateEventFn>
  try {
    event = deps.validateEvent
      ? deps.validateEvent(body, headers, secret)
      : await defaultValidateEvent(body, headers, secret)
  } catch (err) {
    const isSignature = (err as Error)?.name === 'WebhookVerificationError'
    if (isSignature) {
      await deps.notify(
        'signature_failure',
        '\u{26A0}\u{FE0F} <b>Polar webhook signature rejected</b> — a delivery failed verification at hooks.chmonitor.dev.'
      )
      return Response.json({ error: 'Invalid signature' }, { status: 403 })
    }
    console.error('[cloud-hooks] failed to parse Polar event', err)
    return Response.json({ error: 'Bad request' }, { status: 400 })
  }

  if (HANDLED_EVENTS.has(event.type)) {
    const data = event.data as PolarSubscriptionData
    try {
      const applyDeps =
        deps.applyDeps ??
        (env.CHM_CLOUD_D1
          ? makeApplyDeps(env, env.CHM_CLOUD_D1, deps.fetch)
          : null)
      if (applyDeps) {
        await coreApplySubscription(
          data,
          toUnixSeconds(event.timestamp),
          event.type,
          applyDeps
        )
      } else {
        console.error(
          '[cloud-hooks] CHM_CLOUD_D1 unbound; skipping persistence (Polar remains source of truth)'
        )
      }
      await notifyEvent(event.type, data, env, deps)
    } catch (err) {
      console.error('[cloud-hooks] handler error', err)
      return Response.json({ error: 'Handler error' }, { status: 500 })
    }
  }

  return Response.json({ received: true }, { status: 202 })
}

async function notifyEvent(
  eventType: string,
  data: PolarSubscriptionData,
  env: Env,
  deps: WebhookDeps
): Promise<void> {
  const mapped = makePlanForProductId(env)(data.productId)
  const plan = mapped?.planId ?? 'unknown'
  const owner = data.customer?.externalId ?? '(no external id)'
  const kind = kindForEvent(eventType, data.status)
  const icon =
    kind === 'subscription'
      ? '\u{1F195}' // 🆕
      : kind === 'cancel'
        ? '\u{1F534}' // 🔴
        : kind === 'payment_failure'
          ? '\u{1F4B3}' // 💳
          : '\u{1F504}' // 🔄
  const text = `${icon} <b>${eventType}</b>\nplan: <b>${plan}</b> · status: ${data.status}\nowner: <code>${owner}</code>`
  await deps.notify(kind, text)
}
