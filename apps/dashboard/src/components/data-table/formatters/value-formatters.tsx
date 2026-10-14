import type { TextFormatOptions } from '../cells/text-format'
import type { ValueOnlyFormatter } from './types'

import { BadgeFormat } from '../cells/badge-format'
import { BooleanFormat } from '../cells/boolean-format'
import { DurationFormat } from '../cells/duration-format'
import { RelatedTimeFormat } from '../cells/related-time-format'
import { TextFormat } from '../cells/text-format'
import { ColumnFormat } from '@/types/column-format'

export const badgeFormatter: ValueOnlyFormatter = (value) => (
  <BadgeFormat value={value as React.ReactNode} />
)

export const booleanFormatter: ValueOnlyFormatter = (value) => (
  <BooleanFormat value={value as string | number | boolean} />
)

/**
 * Inverted boolean formatter - like {@link booleanFormatter} but renders a
 * truthy value in red (alarming) and a falsy value in green. Use when `true`
 * represents a problem state, e.g. `is_readonly` on the Readonly Tables page.
 */
export const booleanInvertedFormatter: ValueOnlyFormatter = (value) => (
  <BooleanFormat value={value as string | number | boolean} invert />
)

export const durationFormatter: ValueOnlyFormatter = (value) => (
  <DurationFormat value={value as string | number} />
)

export const relatedTimeFormatter: ValueOnlyFormatter = (value) => (
  <RelatedTimeFormat value={value as string} />
)

export const textFormatter: ValueOnlyFormatter = (value, options) => (
  <TextFormat
    value={value as React.ReactNode}
    options={options as TextFormatOptions}
  />
)

export const VALUE_FORMATTERS: Record<
  | ColumnFormat.Badge
  | ColumnFormat.Boolean
  | ColumnFormat.BooleanInverted
  | ColumnFormat.Duration
  | ColumnFormat.RelatedTime
  | ColumnFormat.Text,
  ValueOnlyFormatter
> = {
  [ColumnFormat.Badge]: badgeFormatter,
  [ColumnFormat.Boolean]: booleanFormatter,
  [ColumnFormat.BooleanInverted]: booleanInvertedFormatter,
  [ColumnFormat.Duration]: durationFormatter,
  [ColumnFormat.RelatedTime]: relatedTimeFormatter,
  [ColumnFormat.Text]: textFormatter,
} as const
