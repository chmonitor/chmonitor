import type { RowData } from '@tanstack/react-table'

import type { Action } from '../cells/actions/types'
import type { FormatterProps, RowContextFormatter } from './types'

import { ActionFormat } from '../cells/action-format'
import { InlineActions } from '../cells/actions/inline-actions'
import {
  BackgroundBarFormat,
  type BackgroundBarOptions,
} from '../cells/background-bar-format'
import {
  HoverCardFormat,
  type HoverCardOptions,
} from '../cells/hover-card-format'
import { LinkFormat, type LinkFormatOptions } from '../cells/link-format'
import { RunningQuerySummaryFormat } from '@/components/data-table/cells/running-query-summary-format'
import {
  StackedShareFormat,
  type StackedShareOptions,
} from '@/components/data-table/cells/stacked-share-format'
import { ColumnFormat } from '@/types/column-format'

/**
 * Action formatter - renders action menu for row operations
 *
 * @example
 * ```tsx
 * <ActionFormat
 *   row={row}
 *   value={value}
 *   actions={[{ label: 'Delete', onClick: () => {} }]}
 * />
 * ```
 */
export const actionFormatter: RowContextFormatter = <
  TData extends RowData,
  TValue,
>(
  props: FormatterProps<TData, TValue>
): React.ReactNode => {
  const { row, value, options } = props
  return (
    <ActionFormat
      row={row}
      value={value as React.ReactNode}
      actions={options as Action[]}
    />
  )
}

/**
 * Inline action formatter - renders action buttons as inline icons (no dropdown)
 */
export const inlineActionFormatter: RowContextFormatter = <
  TData extends RowData,
  TValue,
>(
  props: FormatterProps<TData, TValue>
): React.ReactNode => {
  const { row, value, options } = props
  return (
    <InlineActions
      row={row}
      value={value as React.ReactNode}
      actions={options as Action[]}
    />
  )
}

/**
 * Link formatter - creates clickable links with template variable replacement
 *
 * @example
 * ```tsx
 * <LinkFormat
 *   row={row}
 *   data={data}
 *   value={value}
 *   context={{ database: 'system' }}
 *   options={{ href: '/database/[database]/details' }}
 * />
 * ```
 */
export const linkFormatter: RowContextFormatter = <
  TData extends RowData,
  TValue,
>(
  props: FormatterProps<TData, TValue>
): React.ReactNode => {
  const { row, data, value, context, options } = props
  return (
    <LinkFormat
      row={row}
      data={data}
      value={value as React.ReactNode}
      context={context}
      options={options as LinkFormatOptions}
    />
  )
}

/**
 * Background bar formatter - displays value with proportional background bar
 *
 * @example
 * ```tsx
 * <BackgroundBarFormat
 *   table={table}
 *   row={row}
 *   columnName="size"
 *   value={value}
 *   options={{ numberFormat: true }}
 * />
 * ```
 */
export const backgroundBarFormatter: RowContextFormatter = <
  TData extends RowData,
  TValue,
>(
  props: FormatterProps<TData, TValue>
): React.ReactNode => {
  const { table, row, columnName, value, options } = props
  return (
    <BackgroundBarFormat
      table={table}
      row={row}
      columnName={columnName}
      value={value as React.ReactNode}
      options={options as BackgroundBarOptions}
    />
  )
}

/**
 * Hover card formatter - shows additional content on hover
 *
 * @example
 * ```tsx
 * <HoverCardFormat
 *   row={row}
 *   value={value}
 *   options={{ content: 'Additional info: [column_name]' }}
 * />
 * ```
 */
export const hoverCardFormatter: RowContextFormatter = <
  TData extends RowData,
  TValue,
>(
  props: FormatterProps<TData, TValue>
): React.ReactNode => {
  const { row, value, options } = props
  return (
    <HoverCardFormat
      row={row}
      value={value as React.ReactNode}
      options={options as HoverCardOptions}
    />
  )
}

/**
 * Running query summary formatter - renders a responsive process row.
 */
export const runningQuerySummaryFormatter: RowContextFormatter = <
  TData extends RowData,
  TValue,
>(
  props: FormatterProps<TData, TValue>
): React.ReactNode => {
  const { row, value, context } = props
  return (
    <RunningQuerySummaryFormat
      row={row}
      value={value as React.ReactNode}
      context={context}
    />
  )
}

/**
 * Registry of context formatters
 * These formatters need access to row, table, and context data
 */
export const stackedShareFormatter: RowContextFormatter = <
  TData extends RowData,
  TValue,
>(
  props: FormatterProps<TData, TValue>
): React.ReactNode => {
  const { row, options } = props
  return (
    <StackedShareFormat
      row={row}
      options={options as StackedShareOptions | undefined}
    />
  )
}

export const CONTEXT_FORMATTERS: Record<
  | ColumnFormat.Action
  | ColumnFormat.InlineAction
  | ColumnFormat.BackgroundBar
  | ColumnFormat.StackedShare
  | ColumnFormat.HoverCard
  | ColumnFormat.Link
  | ColumnFormat.RunningQuerySummary,
  RowContextFormatter
> = {
  [ColumnFormat.Action]: actionFormatter,
  [ColumnFormat.InlineAction]: inlineActionFormatter,
  [ColumnFormat.BackgroundBar]: backgroundBarFormatter,
  [ColumnFormat.StackedShare]: stackedShareFormatter,
  [ColumnFormat.HoverCard]: hoverCardFormatter,
  [ColumnFormat.Link]: linkFormatter,
  [ColumnFormat.RunningQuerySummary]: runningQuerySummaryFormatter,
} as const
