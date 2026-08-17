/**
 * GET /api/v1/billing/license-checkout?sku=team|unlimited&term=yearly|lifetime
 *
 * Legacy dash URL. Polar checkout lives on cloud-hooks so this route never
 * calls Polar (a missing `{CHECKOUT_ID}` on the old success_url 500'd here).
 * 302 to hooks.chmonitor.dev/checkout/license.
 */
import { createFileRoute } from '@tanstack/react-router'

import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { ApiErrorType } from '@/lib/api/types'

const ROUTE = { route: '/api/v1/billing/license-checkout', method: 'GET' }

const HOOKS_ORIGIN =
  process.env.CHM_LICENSE_CHECKOUT_ORIGIN ?? 'https://hooks.chmonitor.dev'

function isPaidSku(v: string): v is 'team' | 'unlimited' {
  return v === 'team' || v === 'unlimited'
}

async function handleGet({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url)
  const skuRaw = url.searchParams.get('sku') ?? ''
  const termRaw = url.searchParams.get('term') ?? ''
  if (!isPaidSku(skuRaw)) {
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

  try {
    const dest = new URL('/checkout/license', HOOKS_ORIGIN)
    dest.searchParams.set('sku', skuRaw)
    dest.searchParams.set('term', termRaw)
    return Response.redirect(dest.toString(), 302)
  } catch (err) {
    console.error('[license-checkout] redirect to hooks failed', err)
    return createApiErrorResponse(
      {
        type: ApiErrorType.QueryError,
        message: 'License checkout is temporarily unavailable.',
      },
      502,
      ROUTE
    )
  }
}

export const Route = createFileRoute('/api/v1/billing/license-checkout')({
  server: {
    handlers: {
      GET: handleGet,
    },
  },
})

export { handleGet as __handleGetForTests }
