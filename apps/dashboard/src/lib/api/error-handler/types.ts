import type { ApiErrorType } from '@/lib/api/types'

export type ApiHandler = (request: Request) => Promise<Response>

export interface RouteContext {
  readonly route?: string
  readonly method?: string
  readonly hostId?: number | string
}

export interface ErrorDetails {
  readonly type: ApiErrorType
  readonly message: string
  readonly details?: Record<
    string,
    | string
    | number
    | boolean
    | undefined
    | readonly string[]
    | readonly (string | number | boolean)[]
  >
}

export interface ErrorClassification {
  readonly type: ApiErrorType
  readonly message: string
}

export interface StatusCodeMap {
  readonly [key: string]: number
}
