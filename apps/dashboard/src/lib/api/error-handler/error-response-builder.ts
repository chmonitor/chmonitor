import type { ApiResponse } from '@/lib/api/types'
import type { ErrorDetails, RouteContext, StatusCodeMap } from './types'

import { ErrorLogger, error } from '@chm/logger'
import { parseHostIdParam } from '@/lib/api/shared/validators/host-id'
import { ApiErrorType } from '@/lib/api/types'

const STATUS_CODE_MAP: StatusCodeMap = {
  [ApiErrorType.ValidationError]: 400,
  [ApiErrorType.PermissionError]: 403,
  [ApiErrorType.TableNotFound]: 404,
  [ApiErrorType.ColumnNotFound]: 404,
  [ApiErrorType.NetworkError]: 503,
  [ApiErrorType.QueryError]: 500,
  [ApiErrorType.SslError]: 503,
  [ApiErrorType.TimeoutError]: 504,
} as const

export function getStatusCodeForErrorType(errorType: ApiErrorType): number {
  return STATUS_CODE_MAP[errorType] || 500
}

export function createErrorResponse(
  errorDetails: ErrorDetails,
  status: number,
  context?: RouteContext
): Response {
  const parsedHostId = parseHostIdParam(context?.hostId)
  ErrorLogger.logError(new Error(errorDetails.message), {
    component: `API:${context?.route || 'unknown'}`,
    action: context?.method || 'unknown',
    hostId: Number.isNaN(parsedHostId) ? undefined : parsedHostId,
    errorType: errorDetails.type,
  })

  error(
    `[API ${context?.method || ''} ${context?.route || ''}] ${errorDetails.message}`,
    new Error(errorDetails.message),
    {
      component: `API:${context?.route || 'unknown'}`,
      action: context?.method || 'unknown',
      errorType: errorDetails.type,
    }
  )

  const response: ApiResponse = {
    success: false,
    metadata: {
      queryId: '',
      duration: 0,
      rows: 0,
      host: String(context?.hostId || 'unknown'),
    },
    error: errorDetails,
  }

  return Response.json(response, {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

export function createValidationError(
  message: string,
  context?: RouteContext
): Response {
  return createErrorResponse(
    {
      type: ApiErrorType.ValidationError,
      message,
    },
    400,
    context
  )
}

/**
 * Sanitized 500 for internal errors: NEVER echoes the raw `err.message` (D1/ClickHouse/driver
 * internals must not leak). The original error is logged in full server-side with `requestId`.
 */
export function createInternalErrorResponse(
  err: unknown,
  context?: RouteContext,
  requestId?: string
): Response {
  const originalError = err instanceof Error ? err : new Error(String(err))

  const parsedHostId = parseHostIdParam(context?.hostId)
  ErrorLogger.logError(originalError, {
    component: `API:${context?.route || 'unknown'}`,
    action: context?.method || 'unknown',
    hostId: Number.isNaN(parsedHostId) ? undefined : parsedHostId,
    errorType: ApiErrorType.QueryError,
  })

  error(
    `[API ${context?.method || ''} ${context?.route || ''}] Internal error`,
    originalError,
    {
      component: `API:${context?.route || 'unknown'}`,
      action: context?.method || 'unknown',
      errorType: ApiErrorType.QueryError,
      requestId,
    }
  )

  const response: ApiResponse = {
    success: false,
    metadata: {
      queryId: '',
      duration: 0,
      rows: 0,
      host: String(context?.hostId || 'unknown'),
    },
    error: {
      type: ApiErrorType.QueryError,
      message: 'Internal error',
      details: {
        timestamp: new Date().toISOString(),
        ...(requestId ? { requestId } : {}),
      },
    },
  }

  return Response.json(response, {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

export function createNotFoundError(
  message: string,
  context?: RouteContext
): Response {
  return createErrorResponse(
    {
      type: ApiErrorType.TableNotFound,
      message,
    },
    404,
    context
  )
}
