/**
 * GET /licenses/lookup?q= — honor-system order check.
 *
 * If POLAR_ACCESS_TOKEN is set, look up a Polar checkout (by id) or customer
 * (by email / query). 404 JSON when nothing matches. No DRM, no OSS key.
 */

import type { Env } from './env'

import {
  corsPreflight,
  isLicenseTerm,
  isPaidSku,
  jsonResponse,
  methodNotAllowed,
  polarFetch,
} from './license-http'

export interface LicenseLookupDeps {
  fetchImpl?: typeof fetch
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

function metaSkuTerm(meta: unknown): { sku?: string; term?: string } {
  const rec = asRecord(meta)
  const sku =
    typeof rec?.sku === 'string' && isPaidSku(rec.sku) ? rec.sku : undefined
  const term =
    typeof rec?.term === 'string' && isLicenseTerm(rec.term)
      ? rec.term
      : undefined
  return { sku, term }
}

function checkoutPaid(status: string): boolean {
  return status === 'succeeded' || status === 'confirmed'
}

function sanitizeQuery(raw: string): string | null {
  const q = raw.trim()
  if (!q || q.length > 200) return null
  if (q.includes('/') || q.includes('..') || q.includes('\\')) return null
  return q
}

function customerPayload(
  customer: Record<string, unknown>,
  extra: { sku?: string; term?: string; paid?: boolean; status?: string } = {}
) {
  const email = typeof customer.email === 'string' ? customer.email : null
  return {
    found: true as const,
    source: 'customer' as const,
    email,
    status: extra.status,
    sku: extra.sku ?? null,
    term: extra.term ?? null,
    paid: extra.paid ?? false,
  }
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
      if (customer) return jsonResponse(request, customerPayload(customer), 200)
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
      const email =
        typeof rec?.customer_email === 'string'
          ? rec.customer_email
          : typeof asRecord(rec?.customer)?.email === 'string'
            ? (asRecord(rec?.customer)?.email as string)
            : null
      return jsonResponse(
        request,
        {
          found: true,
          source: 'checkout',
          status,
          email,
          sku: sku ?? null,
          term: term ?? null,
          paid: checkoutPaid(status),
        },
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
      if (customer) return jsonResponse(request, customerPayload(customer), 200)
    }

    const byExternal = await polarFetch(
      env,
      `/v1/customers/external/${encodeURIComponent(q)}`,
      { method: 'GET' },
      fetchImpl
    )
    if (byExternal.ok) {
      const customer = asRecord(byExternal.json)
      if (customer) return jsonResponse(request, customerPayload(customer), 200)
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
    if (customer) return jsonResponse(request, customerPayload(customer), 200)

    return jsonResponse(request, { error: 'not_found' }, 404)
  } catch (err) {
    console.error('[cloud-hooks] license lookup failed', err)
    return jsonResponse(request, { error: 'polar_error', status: 502 }, 502)
  }
}
