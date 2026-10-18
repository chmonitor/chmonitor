import type { DataFormat } from '@clickhouse/client'

import type { ApiError } from '@/lib/api/types'

import { ApiErrorType } from '@/lib/api/types'

export const SUPPORTED_FORMATS = ['JSONEachRow', 'JSON', 'CSV', 'TSV'] as const

export function isSupportedFormat(format: string): format is DataFormat {
  return SUPPORTED_FORMATS.includes(
    format as (typeof SUPPORTED_FORMATS)[number]
  )
}

export function validateFormat(format: unknown): ApiError | undefined {
  if (format === undefined || format === null) {
    return undefined
  }

  if (typeof format !== 'string') {
    return {
      type: ApiErrorType.ValidationError,
      message:
        'Invalid format: must be a string. Supported formats: JSONEachRow, JSON, CSV, TSV',
    }
  }

  if (!isSupportedFormat(format)) {
    return {
      type: ApiErrorType.ValidationError,
      message: 'Invalid format. Supported formats: JSONEachRow, JSON, CSV, TSV',
    }
  }

  return undefined
}
