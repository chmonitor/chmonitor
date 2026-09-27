/**
 * GET /checkout/sponsor?amount=99&tier=backer&name=&website=&email=&logo=
 *
 * Starts a Polar pay-what-you-want checkout for a one-off sponsorship and
 * forwards the sponsor's own details so **Polar stores them on the customer
 * account**: `customer_email` + `customer_name` pre-fill the checkout, and
 * `customer_metadata` is copied to the created customer. The same values go
 * into checkout `metadata`, which Polar copies to the order — that is what we
 * read back to build the listing. `website` and `logo` only exist in
 * `customer_metadata`: the Polar customer record already holds the name and
 * email, so this is what actually adds to the account.
 *
 * `amount` is USD dollars (the tier chips and the custom input); send `tier`
 * alone and the price is resolved from `@chm/pricing`. `amount` wins when both
 * are present, so a custom amount typed next to a checked tier is honoured.
 * Polar's checkout `amount` field is cents — we convert. Optional `cents=` is
 * Polar-native. 302 to Polar on success. Never throws: 502 JSON on failure.
 *
 * The product is `chmonitor Sponsor` (`CHM_POLAR_SPONSOR_PRODUCT`, from
 * polar-setup.ts). It was renamed in place, so the id in
 * apps/cloud-hooks/.env.production is the same one the old `donate` key held.
 * Do not invent a product UUID.
 */

import type { SponsorTierId } from '@chm/pricing'
import type { Env } from './env'

import {
  jsonResponse,
  methodNotAllowed,
  polarFetch,
  successOrigin,
} from './license-http'
import { logError } from './log'
import {
  isSponsorEmailAcceptable,
  isSponsorTier,
  sponsorTier,
} from '@chm/pricing'

/** Polar USD custom-price minimum (50 cents). */
export const SPONSOR_MIN_CENTS = 50
/** Sanity cap: $10,000. Polar USD max is far higher. */
export const SPONSOR_MAX_CENTS = 1_000_000

export const SPONSOR_PRODUCT_ENV_KEY = 'CHM_POLAR_SPONSOR_PRODUCT'

export interface SponsorCheckoutDeps {
  fetchImpl?: typeof fetch
}

/** The sponsor's own details, forwarded to Polar. Length-capped only. */
export interface SponsorDetails {
  name?: string
  website?: string
  email?: string
  logo?: string
}

export function sponsorProductId(env: Env): string | undefined {
  const v = env[SPONSOR_PRODUCT_ENV_KEY]
  return typeof v === 'string' && v !== '' ? v : undefined
}

export function sponsorSuccessUrl(origin: string): string {
  return `${origin}/sponsors?sponsored=1&checkout_id={CHECKOUT_ID}`
}

/**
 * Parse `amount` (USD dollars) or `cents` (Polar native); fall back to the
 * price of a valid `tier`. Returns cents for Polar `POST /v1/checkouts/`
 * `amount`. `cents` wins over `amount`, `amount` wins over `tier`.
 */
export function parseSponsorAmount(
  url: URL
): { cents: number; tier?: SponsorTierId } | { error: string } {
  const centsRaw = url.searchParams.get('cents')
  if (centsRaw != null && centsRaw !== '') {
    const n = Number.parseInt(centsRaw, 10)
    if (!Number.isFinite(n) || String(n) !== centsRaw.trim()) {
      return { error: 'cents must be an integer' }
    }
    return clampCents(n)
  }
  const tierRaw = (url.searchParams.get('tier') ?? '').trim()
  const tier = isSponsorTier(tierRaw) ? tierRaw : undefined
  const amountRaw = (url.searchParams.get('amount') ?? '').trim()
  if (!amountRaw) {
    if (tier) {
      return {
        cents: Math.round(sponsorTier(tier).amountUsd * 100),
        tier,
      }
    }
    return {
      error: tierRaw
        ? 'tier must be supporter, backer, or partner'
        : 'amount is required (USD dollars) or tier',
    }
  }
  const dollars = Number(amountRaw)
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return { error: 'amount must be a positive USD number' }
  }
  return { ...clampCents(Math.round(dollars * 100)), tier }
}

function clampCents(cents: number): { cents: number } | { error: string } {
  if (!Number.isInteger(cents)) {
    return { error: 'amount must convert to a whole number of cents' }
  }
  if (cents < SPONSOR_MIN_CENTS) {
    return {
      error: `amount must be at least $${(SPONSOR_MIN_CENTS / 100).toFixed(2)}`,
    }
  }
  if (cents > SPONSOR_MAX_CENTS) {
    return {
      error: `amount must be at most $${(SPONSOR_MAX_CENTS / 100).toFixed(0)}`,
    }
  }
  return { cents }
}

function cap(value: string | null, max: number): string {
  return (value ?? '').replace(/[<>]/g, '').trim().slice(0, max)
}

/**
 * Read the sponsor details off the query.
 *
 * Website and logo are best-effort: a malformed one is dropped, never a 400, so
 * a typo cannot block a payment. The email is different — Polar 422s the whole
 * checkout when it cannot attach a customer to the address, so an unusable one
 * is rejected here, with a message the caller can show.
 */
export function parseSponsorDetails(
  url: URL
): SponsorDetails | { error: string } {
  const out: SponsorDetails = {}
  const name = cap(url.searchParams.get('name'), 120)
  if (name) out.name = name
  const website = cap(url.searchParams.get('website'), 200)
  if (/^https?:\/\/[^\s]+$/.test(website)) out.website = website
  const email = cap(url.searchParams.get('email'), 200)
  if (email) {
    if (!isSponsorEmailAcceptable(email)) {
      return { error: 'email must be a real, deliverable address' }
    }
    out.email = email
  }
  const logo = cap(url.searchParams.get('logo'), 300)
  if (/^https?:\/\/[^\s]+$/.test(logo)) out.logo = logo
  return out
}

export async function handleSponsorCheckout(
  request: Request,
  env: Env,
  deps: SponsorCheckoutDeps = {}
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(request)

  const url = new URL(request.url)
  const parsed = parseSponsorAmount(url)
  if ('error' in parsed) {
    return jsonResponse(request, { error: parsed.error }, 400)
  }
  const details = parseSponsorDetails(url)
  if ('error' in details) {
    return jsonResponse(request, { error: details.error }, 400)
  }

  const token = env.POLAR_ACCESS_TOKEN
  if (!token) {
    return jsonResponse(request, { error: 'billing is not enabled' }, 501)
  }
  const productId = sponsorProductId(env)
  if (!productId) {
    return jsonResponse(
      request,
      { error: 'no Polar sponsor product configured' },
      501
    )
  }

  try {
    const origin = successOrigin(env)
    // Copied to the order — this is what we read back to build the listing.
    const metadata: Record<string, string> = { kind: 'sponsor' }
    if (parsed.tier) metadata.tier = parsed.tier
    if (details.name) metadata.name = details.name
    if (details.website) metadata.website = details.website
    if (details.logo) metadata.logo = details.logo
    // Copied to the Polar customer. Only what the customer record does not
    // already hold: the name and email go through customer_name/email.
    const customerMetadata: Record<string, string> = {}
    if (parsed.tier) customerMetadata.sponsorship = parsed.tier
    if (details.website) customerMetadata.website = details.website
    if (details.logo) customerMetadata.logo = details.logo

    const body: Record<string, unknown> = {
      products: [productId],
      amount: parsed.cents,
      success_url: sponsorSuccessUrl(origin),
      metadata,
    }
    if (details.email) body.customer_email = details.email
    if (details.name) body.customer_name = details.name
    if (Object.keys(customerMetadata).length > 0) {
      body.customer_metadata = customerMetadata
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
      // Polar 422s when it cannot attach the customer to the address (an
      // undeliverable domain we did not predict). That is the sponsor's input,
      // not our gateway, so it is not a 502.
      if (polar.status === 422 && details.email) {
        return jsonResponse(
          request,
          { error: 'polar_rejected_email', status: 422 },
          400
        )
      }
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
    logError('[cloud-hooks] sponsor checkout failed', err)
    return jsonResponse(request, { error: 'polar_error', status: 502 }, 502)
  }
}
