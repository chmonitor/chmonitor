import type { ColumnFormat } from '@/types/column-format'

import { ADVANCED_FORMATTERS } from './advanced-formatters'
import { CONTEXT_FORMATTERS } from './context-formatters'
import { INLINE_FORMATTERS } from './inline-formatters'
import { VALUE_FORMATTERS } from './value-formatters'

export function hasInlineFormatter(format: ColumnFormat): boolean {
  return format in INLINE_FORMATTERS
}

export function hasValueFormatter(format: ColumnFormat): boolean {
  return format in VALUE_FORMATTERS
}

export function hasContextFormatter(format: ColumnFormat): boolean {
  return format in CONTEXT_FORMATTERS
}

export function hasAdvancedFormatter(format: ColumnFormat): boolean {
  return format in ADVANCED_FORMATTERS
}

export function getSupportedFormats(): ColumnFormat[] {
  const inlineFormats = Object.keys(INLINE_FORMATTERS) as ColumnFormat[]
  const valueFormats = Object.keys(VALUE_FORMATTERS) as ColumnFormat[]
  const contextFormats = Object.keys(CONTEXT_FORMATTERS) as ColumnFormat[]
  const advancedFormats = Object.keys(ADVANCED_FORMATTERS) as ColumnFormat[]

  return [
    ...new Set([
      ...inlineFormats,
      ...valueFormats,
      ...contextFormats,
      ...advancedFormats,
    ]),
  ]
}

export function hasFormatter(format: ColumnFormat): boolean {
  return (
    hasInlineFormatter(format) ||
    hasValueFormatter(format) ||
    hasContextFormatter(format) ||
    hasAdvancedFormatter(format)
  )
}
