import type { ByteUnit } from '@/lib/types/user-settings'

import { getFormatSettings } from '@/lib/format-settings'

const BINARY_SIZES = [
  'Bytes',
  'KiB',
  'MiB',
  'GiB',
  'TiB',
  'PiB',
  'EiB',
  'ZiB',
  'YiB',
]
const DECIMAL_SIZES = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

// https://stackoverflow.com/a/18650828
export function formatReadableSize(
  bytes: number,
  decimals = 1,
  unit?: ByteUnit
) {
  if (!+bytes) return '0 Bytes'

  // Default (binary, 1024-based) reproduces the historical output exactly;
  // decimal (1000-based, SI units) is the opt-in alternative.
  const resolvedUnit = unit ?? getFormatSettings().byteUnit
  const k = resolvedUnit === 'decimal' ? 1000 : 1024
  const sizes = resolvedUnit === 'decimal' ? DECIMAL_SIZES : BINARY_SIZES
  const dm = decimals < 0 ? 0 : decimals

  const sign = bytes < 0 ? '-' : ''
  const abs = Math.abs(bytes)
  const i = Math.max(
    0,
    Math.min(Math.floor(Math.log(abs) / Math.log(k)), sizes.length - 1)
  )

  return `${sign}${parseFloat((abs / k ** i).toFixed(dm))} ${sizes[i]}`
}

/**
 * Format a number to a human readable quantity.
 * For example:
 * formatReadableQuantity(123456789) => 123.5M
 * formatReadableQuantity(123456789, 'short') => 123.5M
 * formatReadableQuantity(123456789, 'long') => 123,456,789
 *
 * @param quantity
 * @param preset 'short' or 'long'. When omitted, resolves from the user's
 *   number-format setting (abbreviated → 'short', full → 'long'). Default
 *   settings resolve to 'short', reproducing the historical behaviour.
 * @returns
 */
export function formatReadableQuantity(quantity: number, preset?: string) {
  const resolvedPreset =
    preset ?? (getFormatSettings().numberFormat === 'full' ? 'long' : 'short')

  const options =
    resolvedPreset === 'short'
      ? {
          notation: 'compact' as 'compact',
          compactDisplay: 'short' as 'short',
        }
      : {
          notation: 'standard' as 'standard',
        }

  return new Intl.NumberFormat('en-US', {
    style: 'decimal',
    ...options,
  }).format(quantity)
}

export { formatCompactNumber } from '@/lib/format-number'

export function formatReadableSecondDuration(seconds: number) {
  if (seconds < 1) return '0s'
  if (seconds < 60) return `${seconds}s`

  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export function formatQuery({
  query,
  comment_remove = false,
  truncate,
  trim = true,
}: {
  query: string
  comment_remove?: boolean
  truncate?: number
  trim?: boolean
}) {
  let formattedQuery = comment_remove
    ? query.replace(/\/\*[\s\S]*?\*\//g, '')
    : query

  if (trim) {
    formattedQuery = formattedQuery
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  if (truncate && formattedQuery.length > truncate) {
    formattedQuery = `${formattedQuery.slice(0, truncate)}...`
  }

  return formattedQuery
}
