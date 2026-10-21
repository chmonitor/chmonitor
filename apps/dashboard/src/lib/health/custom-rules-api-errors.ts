/**
 * Maps `CustomRuleStoreError` (+ auth errors + zod validation) to HTTP
 * responses. Mirrors `lib/events/api-errors.ts`.
 */

import { ZodError } from 'zod'

import { CustomRuleStoreError } from './custom-rules-store'
import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { ApiErrorType } from '@/lib/api/types'
import { ConversationStoreError } from '@/lib/conversation-store/types'

export interface CustomRuleRouteContext {
  route: string
  method: string
}

export function mapCustomRuleApiError(
  error: unknown,
  context: CustomRuleRouteContext
): Response {
  if (error instanceof ZodError) {
    return createApiErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: error.issues.map((i) => i.message).join('; '),
      },
      400,
      context
    )
  }

  if (error instanceof CustomRuleStoreError) {
    const status =
      error.code === 'NOT_FOUND'
        ? 404
        : error.code === 'NOT_CONFIGURED'
          ? 501
          : 500
    return createApiErrorResponse(
      { type: ApiErrorType.PermissionError, message: error.message },
      status,
      context
    )
  }

  if (error instanceof ConversationStoreError) {
    const status = error.code === 'UNAUTHORIZED' ? 401 : 500
    return createApiErrorResponse(
      { type: ApiErrorType.PermissionError, message: error.message },
      status,
      context
    )
  }

  if (error instanceof Error) {
    // Rejects off-catalog metrics / non-numeric thresholds / SQL deny-list
    // hits that surface as plain Errors from rule-builder-schema.ts.
    return createApiErrorResponse(
      { type: ApiErrorType.ValidationError, message: error.message },
      400,
      context
    )
  }

  return createApiErrorResponse(
    { type: ApiErrorType.QueryError, message: 'Unknown error' },
    500,
    context
  )
}

/**
 * GET-only: the 501 "not available on this deployment" answer for a list read
 * with no backend. Same status and body shape as {@link mapCustomRuleApiError}
 * (the rule builder reads the 501 as `unavailable`), but NOT logged: a valid
 * deployment without a metadata DB is not an error. Returns `null` for any
 * other error so the caller falls through to the loud mapper; writes never
 * use this.
 */
export function quietNotConfiguredResponse(error: unknown): Response | null {
  if (!(error instanceof CustomRuleStoreError)) return null
  if (error.code !== 'NOT_CONFIGURED') return null
  return Response.json(
    {
      success: false,
      metadata: { queryId: '', duration: 0, rows: 0, host: 'unknown' },
      error: { type: ApiErrorType.PermissionError, message: error.message },
    },
    { status: 501, headers: { 'Content-Type': 'application/json' } }
  )
}
