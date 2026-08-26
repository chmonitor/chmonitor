/**
 * Shared bits for the honor-system license HTTP surface
 * (`/checkout/license`, `/licenses/*`).
 *
 * Polar is called with plain `fetch` (no SDK) so a Polar 4xx/5xx becomes a
 * JSON `{error, status}` instead of an uncaught throw.
 */

import type { LicenseTerm, PaidLicenseId } from '@chm/pricing'
import type { Env } from './env'

import { licensePolarProductEnvKey, PAID_LICENSE_IDS } from '@chm/pricing'

export const LICENSE_SUCCESS_ORIGIN = 'https://chmonitor.dev'
export const LICENSE_REG_KEY_PREFIX = 'license-reg:v1:'
export const LICENSE_PUBLIC_INDEX_KEY = 'license-public:v1'

const PAID = new Set<string>(PAID_LICENSE_IDS)

export function isPaidSku(v: string): v is PaidLicenseId {
  return PAID.has(v)
}

export function isLicenseTerm(v: string): v is LicenseTerm {
  return v === 'yearly' || v === 'lifetime'
}

export function polarApiBase(env: Env): string {
  return env.CHM_POLAR_SERVER === 'production'
    ? 'https://api.polar.sh'
    : 'https://sandbox-api.polar.sh'
}

export function licenseProductId(
  env: Env,
  sku: PaidLicenseId,
  term: LicenseTerm
): string | undefined {
  const v = env[licensePolarProductEnvKey(sku, term)]
  return typeof v === 'string' && v !== '' ? v : undefined
}

export function successOrigin(env: Env): string {
  const v = env.CHM_LICENSE_SUCCESS_ORIGIN
  return typeof v === 'string' && v !== ''
    ? v.replace(/\/$/, '')
    : LICENSE_SUCCESS_ORIGIN
}

export function licenseCheckoutExternalId(
  sku: PaidLicenseId,
  term: LicenseTerm,
  id: string = crypto.randomUUID()
): string {
  return `license_${sku}_${term}_${id}`
}

export function licenseSuccessUrl(
  sku: PaidLicenseId,
  term: LicenseTerm,
  origin: string = LICENSE_SUCCESS_ORIGIN
): string {
  // Polar requires the literal `{CHECKOUT_ID}` placeholder and substitutes it
  // after payment. Encoding the braces makes Polar reject the checkout (422).
  return `${origin}/license/register?sku=${sku}&term=${term}&paid=1&checkout_id={CHECKOUT_ID}`
}

const ALLOWED_ORIGIN =
  /^https:\/\/([a-z0-9-]+\.)*chmonitor\.dev$|^http:\/\/localhost(:\d+)?$/

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin') ?? ''
  if (!origin || !ALLOWED_ORIGIN.test(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  }
}

export function jsonResponse(
  request: Request,
  body: unknown,
  status: number
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...corsHeaders(request),
    },
  })
}

export function corsPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export interface LicenseKV {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

export function metaSkuTerm(meta: unknown): { sku?: string; term?: string } {
  const rec =
    meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : null
  const sku =
    typeof rec?.sku === 'string' && isPaidSku(rec.sku) ? rec.sku : undefined
  const term =
    typeof rec?.term === 'string' && isLicenseTerm(rec.term)
      ? rec.term
      : undefined
  return { sku, term }
}

export function checkoutPaid(status: string): boolean {
  return status === 'succeeded' || status === 'confirmed'
}

/** Fixed-window limiter backed by CHM_HOOKS_KV. Returns false when over limit. */
export async function kvRateLimit(
  kv: LicenseKV | null,
  bucket: string,
  ip: string,
  limit: number,
  windowSeconds: number,
  nowMs: number = Date.now()
): Promise<boolean> {
  if (!kv) return true
  const window = Math.floor(nowMs / (windowSeconds * 1000))
  const key = `rate:${bucket}:${ip}:${window}`
  try {
    const raw = await kv.get(key)
    const n =
      raw && typeof raw === 'string'
        ? ((JSON.parse(raw) as { n?: number }).n ?? 0)
        : 0
    if (n >= limit) return false
    await kv.put(key, JSON.stringify({ n: n + 1 }))
    return true
  } catch {
    return true
  }
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown'
}

export function methodNotAllowed(request: Request): Response {
  return jsonResponse(request, { error: 'method_not_allowed' }, 405)
}

export interface PolarFetchResult {
  ok: boolean
  status: number
  json: unknown
}

export async function polarFetch(
  env: Env,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch
): Promise<PolarFetchResult> {
  const token = env.POLAR_ACCESS_TOKEN
  if (!token)
    return { ok: false, status: 501, json: { error: 'billing is not enabled' } }
  const res = await fetchImpl(`${polarApiBase(env)}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, json }
}
