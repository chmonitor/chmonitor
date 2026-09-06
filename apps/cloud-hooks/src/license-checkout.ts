/**
 * GET /checkout/license?sku=team|unlimited&term=yearly|lifetime
 *
 * Starts a Polar checkout for a self-hosted commercial license. 302 to Polar
 * on success. Never throws — Polar failures become 502 JSON `{error, status}`.
 */

import type { Env } from './env'
import type { NotifyKind } from './telegram'

import {
  isLicenseTerm,
  isPaidSku,
  jsonResponse,
  licenseCheckoutExternalId,
  licenseProductId,
  licenseSuccessUrl,
  methodNotAllowed,
  polarFetch,
  successOrigin,
} from './license-http'
import { logError } from './log'
import { formatCheckoutStarted } from './polar-notify'

export interface LicenseCheckoutDeps {
  fetchImpl?: typeof fetch
  uuid?: () => string
  notify?: (kind: NotifyKind, text: string) => Promise<boolean>
}

export async function handleLicenseCheckout(
  request: Request,
  env: Env,
  deps: LicenseCheckoutDeps = {}
): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(request)

  const url = new URL(request.url)
  const skuRaw = url.searchParams.get('sku') ?? ''
  const termRaw = url.searchParams.get('term') ?? ''
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

  const token = env.POLAR_ACCESS_TOKEN
  if (!token) {
    return jsonResponse(request, { error: 'billing is not enabled' }, 501)
  }
  const productId = licenseProductId(env, skuRaw, termRaw)
  if (!productId) {
    return jsonResponse(
      request,
      { error: `no Polar product configured for ${skuRaw}/${termRaw}` },
      501
    )
  }

  try {
    const externalId = licenseCheckoutExternalId(skuRaw, termRaw, deps.uuid?.())
    const successUrl = licenseSuccessUrl(skuRaw, termRaw, successOrigin(env))
    const email = (url.searchParams.get('email') ?? '').trim()
    const company = (url.searchParams.get('company') ?? '').trim().slice(0, 120)
    const website = (url.searchParams.get('website') ?? '').trim().slice(0, 200)
    const metadata: Record<string, string> = {
      kind: 'selfhost-license',
      sku: skuRaw,
      term: termRaw,
    }
    if (company) metadata.company = company
    if (website) metadata.website = website
    const body: Record<string, unknown> = {
      products: [productId],
      external_customer_id: externalId,
      success_url: successUrl,
      metadata,
      // Polar is merchant of record: checkout asks country, then adds VAT/GST.
      // Business + full billing address is required so tax can be calculated.
      is_business_customer: true,
      require_billing_address: true,
    }
    if (email.includes('@')) body.customer_email = email
    if (company) body.customer_name = company
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
    const checkoutId =
      polar.json &&
      typeof polar.json === 'object' &&
      typeof (polar.json as { id?: unknown }).id === 'string'
        ? (polar.json as { id: string }).id
        : ''
    if (deps.notify) {
      try {
        await deps.notify(
          'checkout_started',
          formatCheckoutStarted({
            sku: skuRaw,
            term: termRaw,
            email: email.includes('@') ? email : undefined,
            company: company || undefined,
            website: website || undefined,
            checkoutId: checkoutId || undefined,
            checkoutUrl,
          })
        )
      } catch (notifyErr) {
        logError('[cloud-hooks] checkout-started notify failed', notifyErr)
      }
    }
    return Response.redirect(checkoutUrl, 302)
  } catch (err) {
    logError('[cloud-hooks] license checkout failed', err)
    return jsonResponse(request, { error: 'polar_error', status: 502 }, 502)
  }
}
