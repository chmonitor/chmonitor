/**
 * Honor-system sponsor listing store (KV).
 *
 * POST /sponsors/register  {name, website, email, tier, checkout_id?}
 *
 * The listing itself is a committed seed (`apps/landing/src/data/sponsors.ts`),
 * because the landing site is static — it cannot read KV per request. This
 * endpoint records what a sponsor wants published so the row can be added after
 * the payment lands. The email is stored for the receipt and never rendered.
 *
 * Tier ids are validated against @chm/pricing, the same list the page renders,
 * so the API can never accept a tier that is not for sale.
 */

import type { SponsorTierId } from '@chm/pricing'
import type { Env } from './env'

import {
  clientIp,
  corsPreflight,
  jsonResponse,
  kvRateLimit,
  type LicenseKV,
  methodNotAllowed,
} from './license-http'
import { logError } from './log'
import { isSponsorTier } from '@chm/pricing'

export const SPONSOR_REG_KEY_PREFIX = 'sponsor-reg:v1:'

export interface SponsorRegistration {
  id: string
  /** Public name for the listing. */
  name: string
  /** Public site, linked from the hero slot and the sponsors page. */
  website: string
  /** Receipt + listing contact. Stored, never published. */
  email: string
  tier: SponsorTierId
  /** Polar checkout id from the receipt, when the sponsor has it. */
  checkout_id?: string
  logo?: string
  registered_at: string
}

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[<>]/g, '').trim().slice(0, max)
}

function parseWebsite(raw: string): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

/** Loose shape check — the confirmation email, not an identity proof. */
function parseEmail(raw: string): string | null {
  if (!raw || raw.length > 200) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null
}

export async function handleSponsorRegister(
  request: Request,
  env: Env,
  deps: {
    kv?: LicenseKV | null
    uuid?: () => string
    now?: () => Date
    nowMs?: number
  } = {}
): Promise<Response> {
  if (request.method === 'OPTIONS') return corsPreflight(request)
  if (request.method !== 'POST') return methodNotAllowed(request)

  const kv = deps.kv ?? env.CHM_HOOKS_KV ?? null
  if (!kv) {
    return jsonResponse(request, { error: 'sponsor store not configured' }, 501)
  }

  const allowed = await kvRateLimit(
    kv,
    'sponsor-reg',
    clientIp(request),
    5,
    3600,
    deps.nowMs
  )
  if (!allowed) {
    return jsonResponse(request, { error: 'rate_limited' }, 429)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(request, { error: 'invalid json' }, 400)
  }
  const rec =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  if (!rec) return jsonResponse(request, { error: 'invalid json' }, 400)

  const name = clean(rec.name, 120)
  const website = parseWebsite(clean(rec.website, 200))
  const email = parseEmail(clean(rec.email, 200))
  const tierRaw = clean(rec.tier, 32)
  if (!name) {
    return jsonResponse(request, { error: 'name is required' }, 400)
  }
  if (!website) {
    return jsonResponse(
      request,
      { error: 'website must be an http(s) url' },
      400
    )
  }
  if (!email) {
    return jsonResponse(
      request,
      { error: 'email is required for the receipt' },
      400
    )
  }
  if (!isSponsorTier(tierRaw)) {
    return jsonResponse(request, { error: 'unknown sponsor tier' }, 400)
  }

  const row: SponsorRegistration = {
    id: deps.uuid?.() ?? crypto.randomUUID(),
    name,
    website,
    email,
    tier: tierRaw,
    registered_at: (deps.now?.() ?? new Date()).toISOString(),
  }
  const checkoutId = clean(rec.checkout_id, 80)
  if (checkoutId) row.checkout_id = checkoutId
  const logo = clean(rec.logo, 300)
  if (logo) row.logo = logo

  try {
    await kv.put(`${SPONSOR_REG_KEY_PREFIX}${row.id}`, JSON.stringify(row))
  } catch (err) {
    logError('[cloud-hooks] sponsor register store failed', { err })
    return jsonResponse(request, { error: 'store_error', status: 502 }, 502)
  }

  // No echo of the stored row: the response is the id only, so a caller that
  // logs it cannot leak the sponsor's email.
  return jsonResponse(request, { ok: true, id: row.id }, 201)
}
