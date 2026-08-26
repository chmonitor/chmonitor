/**
 * GET /licenses/lookup?q= — honor-system order check.
 *
 * If POLAR_ACCESS_TOKEN is set, look up a Polar checkout (by id) or customer
 * (by email / query). 404 JSON when nothing matches. Returns only paid state
 * and sku/term — not customer email or raw Polar status.
 */

import type { Env } from './env'

import {
  checkoutPaid,
  clientIp,
  corsPreflight,
  jsonResponse,
  kvRateLimit,
  metaSkuTerm,
  methodNotAllowed,
  polarFetch,
} from './license-http'
import { logError } from './log'

export interface LicenseLookupDeps {
  fetchImpl?: typeof fetch
  nowMs?: number
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

function firstItem(json: unknown): Record<string, unknown> | null {
  const rec = asRecord(json)
  const items = rec?.items
  if (!Array.isArray(items) || items.length === 0) return null
  return asRecord(items[0])
}

function lookupPayload(input: {
  source: 'customer' | 'checkout'
  sku?: string | null
  term?: string | null
  paid?: boolean
}) {
  return {
    found: true as const,
    source: input.source,
    sku: input.sku ?? null,
    term: input.term ?? null,
    paid: input.paid ?? false,
  }
}

function sanitizeQuery(raw: string): string | null {
  const q = raw.trim()
  if (!q || q.length > 200) return null
  if (q.includes('/') || q.includes('..') || q.includes('\\')) return null
  return q
}

export async function handleLicenseLookup(
  request: Request,
  env: Env,
  deps: LicenseLookupDeps = {}
): Promise<Response> {
  if (request.method === 'OPTIONS') return corsPreflight(request)
  if (request.method !== 'GET') return methodNotAllowed(request)

  const url = new URL(request.url)
  const q = sanitizeQuery(url.searchParams.get('q') ?? '')
  if (!q) {
    return jsonResponse(request, { error: 'q is required' }, 400)
  }
  if (!env.POLAR_ACCESS_TOKEN) {
    return jsonResponse(request, { error: 'billing is not enabled' }, 501)
  }

  const kv = env.CHM_HOOKS_KV ?? null
  const allowed = await kvRateLimit(
    kv,
    'lic-lookup',
    clientIp(request),
    20,
    3600,
    deps.nowMs
  )
  if (!allowed) {
    return jsonResponse(request, { error: 'rate_limited' }, 429)
  }

  const fetchImpl = deps.fetchImpl ?? fetch

  try {
    const looksLikeEmail = q.includes('@')
    if (looksLikeEmail) {
      const polar = await polarFetch(
        env,
        `/v1/customers/?email=${encodeURIComponent(q)}&limit=1`,
        { method: 'GET' },
        fetchImpl
      )
      if (!polar.ok && polar.status !== 404) {
        return jsonResponse(
          request,
          { error: 'polar_error', status: polar.status },
          502
        )
      }
      const customer = firstItem(polar.json)
      if (customer) {
        return jsonResponse(
          request,
          lookupPayload({ source: 'customer', paid: false }),
          200
        )
      }
      return jsonResponse(request, { error: 'not_found' }, 404)
    }

    const checkout = await polarFetch(
      env,
      `/v1/checkouts/${encodeURIComponent(q)}`,
      { method: 'GET' },
      fetchImpl
    )
    if (checkout.ok) {
      const rec = asRecord(checkout.json)
      const status = typeof rec?.status === 'string' ? rec.status : ''
      const { sku, term } = metaSkuTerm(rec?.metadata)
      return jsonResponse(
        request,
        lookupPayload({
          source: 'checkout',
          sku: sku ?? null,
          term: term ?? null,
          paid: checkoutPaid(status),
        }),
        200
      )
    }
    if (checkout.status !== 404) {
      return jsonResponse(
        request,
        { error: 'polar_error', status: checkout.status },
        502
      )
    }

    const byId = await polarFetch(
      env,
      `/v1/customers/${encodeURIComponent(q)}`,
      { method: 'GET' },
      fetchImpl
    )
    if (byId.ok) {
      const customer = asRecord(byId.json)
      if (customer) {
        return jsonResponse(
          request,
          lookupPayload({ source: 'customer', paid: false }),
          200
        )
      }
    }

    const byExternal = await polarFetch(
      env,
      `/v1/customers/external/${encodeURIComponent(q)}`,
      { method: 'GET' },
      fetchImpl
    )
    if (byExternal.ok) {
      const customer = asRecord(byExternal.json)
      if (customer) {
        return jsonResponse(
          request,
          lookupPayload({ source: 'customer', paid: false }),
          200
        )
      }
    }

    const listed = await polarFetch(
      env,
      `/v1/customers/?query=${encodeURIComponent(q)}&limit=1`,
      { method: 'GET' },
      fetchImpl
    )
    if (!listed.ok && listed.status !== 404) {
      return jsonResponse(
        request,
        { error: 'polar_error', status: listed.status },
        502
      )
    }
    const customer = firstItem(listed.json)
    if (customer) {
      return jsonResponse(
        request,
        lookupPayload({ source: 'customer', paid: false }),
        200
      )
    }

    return jsonResponse(request, { error: 'not_found' }, 404)
  } catch (err) {
    logError('[cloud-hooks] license lookup failed', { err })
    return jsonResponse(request, { error: 'polar_error', status: 502 }, 502)
  }
}
