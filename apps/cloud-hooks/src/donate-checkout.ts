/**
 * GET /checkout/donate?amount=N
 *
 * Starts a Polar pay-what-you-want checkout for a one-off donation.
 * `amount` is USD dollars (chips pass 10 / 100 / 1000). Polar's checkout
 * `amount` field is cents — we convert. Optional `cents=` is Polar-native.
 * 302 to Polar on success. Never throws — Polar failures become 502 JSON.
 *
 * Product id is `CHM_POLAR_DONATE_PRODUCT` (from polar-setup.ts). Unset token
 * or product → 501. Do not invent a product UUID.
 */

import type { Env } from './env'

import {
  jsonResponse,
  methodNotAllowed,
  polarFetch,
  successOrigin,
} from './license-http'
import { logError } from './log'

/** Polar USD custom-price minimum (50 cents). */
export const DONATE_MIN_CENTS = 50
/** Sanity cap: $10,000. Polar USD max is far higher. */
export const DONATE_MAX_CENTS = 1_000_000

export const DONATE_POLAR_PRODUCT_NAME = 'chmonitor Donate'
export const DONATE_PRODUCT_ENV_KEY = 'CHM_POLAR_DONATE_PRODUCT'

export interface DonateCheckoutDeps {
  fetchImpl?: typeof fetch
}

export function donateProductId(env: Env): string | undefined {
  const v = env.CHM_POLAR_DONATE_PRODUCT
  return typeof v === 'string' && v !== '' ? v : undefined
}

export function donateSuccessUrl(origin: string): string {
  return `${origin}/license?donated=1&checkout_id={CHECKOUT_ID}`
}

/**
 * Parse `amount` (USD dollars) or `cents` (Polar native). `cents` wins when
 * both are set. Returns cents for Polar `POST /v1/checkouts/` `amount`.
 */
export function parseDonateAmount(
  url: URL
): { cents: number } | { error: string } {
  const centsRaw = url.searchParams.get('cents')
  if (centsRaw != null && centsRaw !== '') {
    const n = Number.parseInt(centsRaw, 10)
    if (!Number.isFinite(n) || String(n) !== centsRaw.trim()) {
      return { error: 'cents must be an integer' }
    }
    return clampCents(n)
  }
  const amountRaw = (url.searchParams.get('amount') ?? '').trim()
  if (!amountRaw) {
    return { error: 'amount is required (USD dollars) or cents' }
  }
  const dollars = Number(amountRaw)
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return { error: 'amount must be a positive USD number' }
  }
  return clampCents(Math.round(dollars * 100))
}

function clampCents(cents: number): { cents: number } | { error: string } {
  if (!Number.isInteger(cents)) {
    return { error: 'amount must convert to a whole number of cents' }
  }
  if (cents < DONATE_MIN_CENTS) {
    return {
      error: `amount must be at least $${(DONATE_MIN_CENTS / 100).toFixed(2)}`,
    }
  }
  if (cents > DONATE_MAX_CENTS) {
    return {
      error: `amount must be at most $${(DONATE_MAX_CENTS / 100).toFixed(0)}`,
    }
  }
  return { cents }
}

export async function handleDonateCheckout(
  request: Request,
  env: Env,
  deps: DonateCheckoutDeps = {}
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(request)

  const parsed = parseDonateAmount(new URL(request.url))
  if ('error' in parsed) {
    return jsonResponse(request, { error: parsed.error }, 400)
  }

  const token = env.POLAR_ACCESS_TOKEN
  if (!token) {
    return jsonResponse(request, { error: 'billing is not enabled' }, 501)
  }
  const productId = donateProductId(env)
  if (!productId) {
    return jsonResponse(
      request,
      { error: 'no Polar donate product configured' },
      501
    )
  }

  try {
    const origin = successOrigin(env)
    const body: Record<string, unknown> = {
      products: [productId],
      amount: parsed.cents,
      success_url: donateSuccessUrl(origin),
      metadata: { kind: 'donate' },
    }
    const polar = await polarFetch(
      env,
      '/v1/checkouts/',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      deps.fetchImpl ?? fetch
    )
    if (!polar.ok) {
      return jsonResponse(
        request,
        { error: 'polar_error', status: polar.status },
        502
      )
    }
    const checkoutUrl =
      polar.json &&
      typeof polar.json === 'object' &&
      typeof (polar.json as { url?: unknown }).url === 'string'
        ? (polar.json as { url: string }).url
        : ''
    if (!checkoutUrl) {
      return jsonResponse(
        request,
        { error: 'polar_error', status: polar.status || 502 },
        502
      )
    }
    return Response.redirect(checkoutUrl, 302)
  } catch (err) {
    logError('[cloud-hooks] donate checkout failed', err)
    return jsonResponse(request, { error: 'polar_error', status: 502 }, 502)
  }
}
