/**
 * GET /checkout/license?sku=team|unlimited&term=yearly|lifetime
 *
 * Starts a Polar checkout for a self-hosted commercial license. 302 to Polar
 * on success. Never throws — Polar failures become 502 JSON `{error, status}`.
 */

import type { Env } from './env'

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

export interface LicenseCheckoutDeps {
  fetchImpl?: typeof fetch
  uuid?: () => string
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
    const polar = await polarFetch(
      env,
      '/v1/checkouts/',
      {
        method: 'POST',
        body: JSON.stringify({
          products: [productId],
          external_customer_id: externalId,
          success_url: successUrl,
          metadata: { kind: 'selfhost-license', sku: skuRaw, term: termRaw },
        }),
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
    console.error('[cloud-hooks] license checkout failed', err)
    return jsonResponse(request, { error: 'polar_error', status: 502 }, 502)
  }
}
