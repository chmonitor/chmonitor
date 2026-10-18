import type {
  ApiErrorType,
  ApiResponse,
  ApiResponseMetadata,
} from '@/lib/api/types'

export interface SuccessResponseMeta {
  readonly sql?: string
  readonly rows?: number
  readonly cached?: boolean
  readonly cachedAt?: number
  readonly duration?: number
  readonly queryId?: string
  readonly apiUrl?: string
  readonly apiParams?: Record<string, string | number | boolean | undefined>
  readonly timezone?: string
}

export type HttpStatus = number

export const CacheControl = {
  NONE: 'private, max-age=0',
  SHORT: 'public, s-maxage=30, stale-while-revalidate=60',
  MEDIUM: 'public, s-maxage=60, stale-while-revalidate=120',
  LONG: 'public, s-maxage=300, stale-while-revalidate=600',
} as const

export type CacheControlPreset = keyof typeof CacheControl

/**
 * Default cache control headers for API responses
 * @deprecated Use CacheControl.SHORT instead
 */
const DEFAULT_CACHE_HEADERS = {
  'Cache-Control': CacheControl.SHORT,
}

export function createSuccessResponse<T>(
  data: T,
  meta?: SuccessResponseMeta,
  status: HttpStatus = 200,
  headers?: HeadersInit
): Response {
  const responseMetadata: ApiResponseMetadata = {
    queryId: meta?.queryId ? String(meta.queryId) : '',
    duration: meta?.duration ? Number(meta.duration) : 0,
    rows: meta?.rows ? Number(meta.rows) : 0,
    host: '', // Will be populated by route handler
    ...(meta?.cachedAt && { cachedAt: Number(meta.cachedAt) }),
    ...(meta?.sql && { sql: String(meta.sql) }),
    ...(meta?.apiUrl && { apiUrl: String(meta.apiUrl) }),
    ...(meta?.apiParams && { apiParams: meta.apiParams }),
    ...(meta?.timezone && { timezone: String(meta.timezone) }),
  }

  const response: ApiResponse<T> = {
    success: true,
    data,
    metadata: responseMetadata,
  }

  // Default cache headers apply to successful GET-like responses, but
  // caller-supplied headers must WIN — otherwise createCachedResponse's custom
  // Cache-Control is silently clobbered by the default, defeating its purpose.
  // Spread defaults first, then `headers`, so explicit values take precedence.
  const responseHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...(status >= 200 && status < 300 ? DEFAULT_CACHE_HEADERS : {}),
    ...headers,
  }

  return Response.json(response, {
    status,
    headers: responseHeaders,
  })
}

export function createErrorResponse(
  error: {
    readonly type: ApiErrorType
    readonly message: string
    readonly details?: {
      readonly [key: string]: string | number | boolean | undefined
    }
  },
  status: HttpStatus,
  context?: {
    readonly route?: string
    readonly method?: string
    readonly hostId?: number | string
  }
): Response {
  const response: ApiResponse = {
    success: false,
    metadata: {
      queryId: '',
      duration: 0,
      rows: 0,
      host: String(context?.hostId || 'unknown'),
    },
    error,
  }

  return Response.json(response, {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

export function createCachedResponse<T>(
  data: T,
  cacheControl: string,
  meta?: SuccessResponseMeta
): Response {
  return createSuccessResponse(data, meta, 200, {
    'Cache-Control': cacheControl,
  })
}

export function createPlainResponse<T>(
  data: T,
  status: HttpStatus = 200
): Response {
  return Response.json(data, {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}
