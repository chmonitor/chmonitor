import type { ApiError } from '@/lib/api/types'

export interface ValidationError {
  readonly field: string
  readonly message: string
  readonly value?: unknown
}

export interface ValidationResult {
  readonly valid: boolean
  readonly error?: ApiError
}
