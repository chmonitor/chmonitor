/**
 * Honor-system license registration store (KV).
 *
 * POST /licenses/register  {company, website, sku, term, list_public, checkout_id?}
 * GET  /licenses/public    rows that opted in to the customers wall
 */

import type { LicenseTerm, PaidLicenseId } from '@chm/pricing'
import type { Env } from './env'

import {
  corsPreflight,
  isLicenseTerm,
  isPaidSku,
  jsonResponse,
  LICENSE_PUBLIC_INDEX_KEY,
  LICENSE_REG_KEY_PREFIX,
  methodNotAllowed,
} from './license-http'

export interface LicenseKV {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

export interface LicenseRegistration {
  id: string
  company: string
  website: string
  sku: PaidLicenseId
  term: LicenseTerm
  list_public: boolean
  checkout_id?: string
  email?: string
  notes?: string
  registered_at: string
}

export interface PublicLicense {
  company: string
  website: string
  sku: PaidLicenseId
  term: LicenseTerm
  registered_at: string
}

const PUBLIC_CAP = 500

function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[<>]/g, '').trim().slice(0, max)
}

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes' || value === 1
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

function toPublic(row: LicenseRegistration): PublicLicense {
  return {
    company: row.company,
    website: row.website,
    sku: row.sku,
    term: row.term,
    registered_at: row.registered_at,
  }
}

async function readPublicIndex(kv: LicenseKV): Promise<PublicLicense[]> {
  const raw = await kv.get(LICENSE_PUBLIC_INDEX_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as PublicLicense[]) : []
  } catch {
    return []
  }
}

export async function handleLicenseRegister(
  request: Request,
  env: Env,
  deps: { kv?: LicenseKV | null; uuid?: () => string; now?: () => Date } = {}
): Promise<Response> {
  if (request.method === 'OPTIONS') return corsPreflight(request)
  if (request.method !== 'POST') return methodNotAllowed(request)

  const kv = deps.kv ?? env.CHM_HOOKS_KV ?? null
  if (!kv) {
    return jsonResponse(
      request,
      { error: 'registration store not configured' },
      501
    )
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

  const company = clean(rec.company, 120)
  const website = parseWebsite(clean(rec.website, 200))
  const skuRaw = clean(rec.sku, 32)
  const termRaw = clean(rec.term, 16)
  if (!company)
    return jsonResponse(request, { error: 'company is required' }, 400)
  if (!website) {
    return jsonResponse(
      request,
      { error: 'website must be an http(s) url' },
      400
    )
  }
  if (!isPaidSku(skuRaw)) {
    return jsonResponse(
      request,
      { error: 'sku must be team or unlimited' },
      400
    )
  }
  if (!isLicenseTerm(termRaw)) {
    return jsonResponse(
      request,
      { error: 'term must be yearly or lifetime' },
      400
    )
  }

  const row: LicenseRegistration = {
    id: deps.uuid?.() ?? crypto.randomUUID(),
    company,
    website,
    sku: skuRaw,
    term: termRaw,
    list_public: asBool(rec.list_public),
    registered_at: (deps.now?.() ?? new Date()).toISOString(),
  }
  const checkoutId = clean(rec.checkout_id, 80)
  if (checkoutId) row.checkout_id = checkoutId
  const email = clean(rec.email, 200)
  if (email) row.email = email
  const notes = clean(rec.notes, 2000)
  if (notes) row.notes = notes

  try {
    await kv.put(`${LICENSE_REG_KEY_PREFIX}${row.id}`, JSON.stringify(row))
    if (row.list_public) {
      const index = await readPublicIndex(kv)
      if (index.length < PUBLIC_CAP) {
        index.push(toPublic(row))
        await kv.put(LICENSE_PUBLIC_INDEX_KEY, JSON.stringify(index))
      }
    }
  } catch (err) {
    console.error('[cloud-hooks] license register store failed', err)
    return jsonResponse(request, { error: 'store_error', status: 502 }, 502)
  }

  return jsonResponse(request, { ok: true, id: row.id }, 201)
}

export async function handleLicensePublic(
  request: Request,
  env: Env,
  deps: { kv?: LicenseKV | null } = {}
): Promise<Response> {
  if (request.method === 'OPTIONS') return corsPreflight(request)
  if (request.method !== 'GET') return methodNotAllowed(request)

  const kv = deps.kv ?? env.CHM_HOOKS_KV ?? null
  if (!kv) return jsonResponse(request, { licenses: [] }, 200)

  try {
    const licenses = (await readPublicIndex(kv)).filter((row) => row.company)
    return jsonResponse(request, { licenses }, 200)
  } catch (err) {
    console.error('[cloud-hooks] license public list failed', err)
    return jsonResponse(request, { error: 'store_error', status: 502 }, 502)
  }
}
