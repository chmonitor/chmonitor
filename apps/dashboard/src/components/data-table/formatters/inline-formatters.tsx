import type { InlineFormatter } from './types'

import { formatReadableQuantity } from '@/lib/format-readable'
import { ColumnFormat } from '@/types/column-format'

export const codeFormatter: InlineFormatter = (value) => (
  <code>{value as string}</code>
)

export const numberFormatter: InlineFormatter = (value) => (
  <span className="text-right text-nowrap font-mono tabular-nums">
    {formatReadableQuantity(value as number, 'long')}
  </span>
)

export const numberShortFormatter: InlineFormatter = (value) =>
  formatReadableQuantity(value as number, 'short')

export const INLINE_FORMATTERS: Record<
  ColumnFormat.Code | ColumnFormat.Number | ColumnFormat.NumberShort,
  InlineFormatter
> = {
  [ColumnFormat.Code]: codeFormatter,
  [ColumnFormat.Number]: numberFormatter,
  [ColumnFormat.NumberShort]: numberShortFormatter,
} as const
