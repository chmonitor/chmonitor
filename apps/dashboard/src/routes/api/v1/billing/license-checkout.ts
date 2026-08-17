/**
 * GET /api/v1/billing/license-checkout?sku=team|unlimited&term=yearly|lifetime
 *
 * Starts a Polar checkout for a self-hosted license. No Clerk session required
 * (honor-system commercial license). Redirects the browser to Polar, then
 * Polar returns to chmonitor.dev/license/register to collect company + website.
 */
import { createFileRoute } from '@tanstack/react-router'

import type { LicenseTerm, PaidLicenseId } from '@chm/pricing'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { ApiErrorType } from '@/lib/api/types'
import {
  getPolarClient,
  isBillingConfigured,
  isPaidLicenseId,
  licenseProductIdFor,
} from '@/lib/billing/polar-config'

const ROUTE = { route: '/api/v1/billing/license-checkout', method: 'GET' }

const LICENSE_SUCCESS_ORIGIN =
  process.env.CHM_LICENSE_SUCCESS_ORIGIN ?? 'https://chmonitor.dev'

function licenseCheckoutExternalId(
  sku: PaidLicenseId,
  term: LicenseTerm
): string {
  return `license_${sku}_${term}_${crypto.randomUUID()}`
}

async function handleGet({ request }: { request: Request }): Promise<Response> {
  if (!isBillingConfigured()) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: 'Billing is not enabled.',
      },
      501,
      ROUTE
    )
  }

  const url = new URL(request.url)
  const skuRaw = url.searchParams.get('sku') ?? ''
  const termRaw = url.searchParams.get('term') ?? ''
  if (!isPaidLicenseId(skuRaw)) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'sku must be team or unlimited',
      },
      400,
      ROUTE
    )
  }
  if (termRaw !== 'yearly' && termRaw !== 'lifetime') {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'term must be yearly or lifetime',
      },
      400,
      ROUTE
    )
  }
  const sku: PaidLicenseId = skuRaw
  const term: LicenseTerm = termRaw

  const productId = licenseProductIdFor(sku, term)
  if (!productId) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.PermissionError,
        message: `No Polar product configured for ${sku}/${term}.`,
      },
      501,
      ROUTE
    )
  }

  const successUrl = `${LICENSE_SUCCESS_ORIGIN}/license/register?sku=${sku}&term=${term}&paid=1`
  const checkout = await getPolarClient().checkouts.create({
    products: [productId],
    externalCustomerId: licenseCheckoutExternalId(sku, term),
    successUrl,
    metadata: { kind: 'selfhost-license', sku, term },
  })
  return Response.redirect(checkout.url, 302)
}

export const Route = createFileRoute('/api/v1/billing/license-checkout')({
  server: {
    handlers: {
      GET: handleGet,
    },
  },
})

export { handleGet as __handleGetForTests }
