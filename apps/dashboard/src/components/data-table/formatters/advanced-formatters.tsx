import type { RowData } from '@tanstack/react-table'

import type { MarkdownFormatOptions } from '../cells/markdown-format'
import type {
  FormatterProps,
  RowContextFormatter,
  ValueOnlyFormatter,
} from './types'

import {
  CodeDialogFormat,
  type CodeDialogOptions,
} from '../cells/code-dialog-format'
import {
  CodeToggleFormat,
  type CodeToggleOptions,
} from '../cells/code-toggle-format'
import {
  ColoredBadgeFormat,
  type ColoredBadgeOptions,
} from '../cells/colored-badge-format'
import { lazy, Suspense } from 'react'
import { ColumnFormat } from '@/types/column-format'

export const codeDialogFormatter: ValueOnlyFormatter = (value, options) => (
  <CodeDialogFormat
    value={value as string}
    options={options as CodeDialogOptions}
  />
)

export const codeToggleFormatter: RowContextFormatter = <
  TData extends RowData,
  TValue,
>(
  props: FormatterProps<TData, TValue>
): React.ReactNode => {
  const { row, value, options } = props
  return (
    <CodeToggleFormat
      row={row}
      value={value as string}
      options={options as CodeToggleOptions}
    />
  )
}

/**
 * `react-markdown` + its plugins are ~160 KB, and this registry is imported by
 * the data-table formatter lookup — so a static import pulled markdown into
 * every page that renders a table, whether or not any column asks for the
 * markdown format. Deferring it here keeps that cost on the tables that
 * actually use it. The fallback renders the raw value, so a cell shows its
 * text immediately and simply gains formatting once the chunk lands.
 */
const MarkdownFormatLazy = lazy(async () => {
  const m = await import('../cells/markdown-format')
  return { default: m.MarkdownFormat }
})

export const markdownFormatter: ValueOnlyFormatter = (value, options) => (
  <Suspense
    fallback={<span className="truncate text-wrap">{`${value ?? ''}`}</span>}
  >
    <MarkdownFormatLazy
      value={value as React.ReactNode}
      options={options as MarkdownFormatOptions}
    />
  </Suspense>
)

export const coloredBadgeFormatter: ValueOnlyFormatter = (value, options) =>
  value ? (
    <ColoredBadgeFormat
      value={value as React.ReactNode}
      options={options as ColoredBadgeOptions}
    />
  ) : null

export const ADVANCED_FORMATTERS: Record<
  | ColumnFormat.CodeDialog
  | ColumnFormat.CodeToggle
  | ColumnFormat.Markdown
  | ColumnFormat.ColoredBadge,
  ValueOnlyFormatter | RowContextFormatter
> = {
  [ColumnFormat.CodeDialog]: codeDialogFormatter,
  [ColumnFormat.CodeToggle]: codeToggleFormatter,
  [ColumnFormat.Markdown]: markdownFormatter,
  [ColumnFormat.ColoredBadge]: coloredBadgeFormatter,
} as const
