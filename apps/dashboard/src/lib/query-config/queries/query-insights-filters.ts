import {
  ClockIcon,
  DatabaseIcon,
  LayersIcon,
  MonitorIcon,
  UserIcon,
} from 'lucide-react'

import type { FilterField, FilterSchema } from '@/lib/filters/types'

/** Bound a dynamic `select` option lookup to a cheap recent window. */
export function queryLogDynamicOptions(column: string) {
  return {
    table: 'system.query_log',
    column,
    where: 'event_time > now() - toIntervalDay(7)',
  }
}

/**
 * Time-range field shared by every Query Insights surface. Exported
 * separately (not just inline in {@link queryInsightsFilterSchema}) so a
 * future consumer that only needs the time field — without pulling in the
 * whole schema, or writing a `.find()` + non-null assertion into its
 * `fields` array — can reuse the exact same field: same key, operators, and
 * default. The pattern detail flyout (`pattern-detail-sheet.tsx`) reads the
 * page's `event_time` URL value directly instead, since it forwards it to
 * `/api/v1/insights/query-patterns/:hash`'s `range` (hours) param rather
 * than through the filter-schema WHERE-builder.
 */
export const eventTimeFilterField: FilterField = {
  key: 'event_time',
  column: 'event_time',
  label: 'Time',
  type: 'datetime',
  operators: ['withinHours', 'between', 'gte', 'lte'],
  icon: ClockIcon,
  options: [
    { label: 'Last 1 hour', value: '1' },
    { label: 'Last 6 hours', value: '6' },
    { label: 'Last 24 hours', value: '24' },
    { label: 'Last 7 days', value: '168' },
    { label: 'Last 30 days', value: '720' },
  ],
  description: 'Relative window or an explicit date range.',
  defaultValue: { operator: 'withinHours', value: '24' },
}

/**
 * Shared filter schema for the Query Insights surfaces — Slow Query Patterns
 * (#2261), Recent Queries (#2262), the pattern detail flyout (#2262), and the
 * forthcoming overview grid (#2260). One definition means "time / user /
 * query kind / database / client" filter identically, with the same URL
 * param keys, everywhere `<FilterBar queryConfig={...} />` renders them.
 *
 * Keep this schema's field `key`s stable — they double as URL query-param
 * names, so renaming one breaks shared/bookmarked links across every page
 * that uses it.
 */
export const queryInsightsFilterSchema: FilterSchema = {
  fields: [
    eventTimeFilterField,
    {
      key: 'user',
      column: 'user',
      label: 'User',
      type: 'select',
      operators: ['in', 'notIn', 'eq', 'ne', 'contains'],
      dynamicOptions: queryLogDynamicOptions('user'),
      icon: UserIcon,
      description: 'Restrict the underlying executions to this user.',
    },
    {
      key: 'query_kind',
      column: 'query_kind',
      label: 'Query kind',
      type: 'select',
      operators: ['in', 'eq', 'ne'],
      icon: LayersIcon,
      options: [
        { label: 'Select', value: 'Select' },
        { label: 'Insert', value: 'Insert' },
        { label: 'Create', value: 'Create' },
        { label: 'Alter', value: 'Alter' },
        { label: 'Drop', value: 'Drop' },
        { label: 'Rename', value: 'Rename' },
        { label: 'Optimize', value: 'Optimize' },
        { label: 'System', value: 'System' },
        { label: 'Show', value: 'Show' },
        { label: 'Set', value: 'Set' },
        { label: 'Backup', value: 'Backup' },
      ],
    },
    {
      key: 'database',
      column: 'current_database',
      label: 'Database',
      type: 'select',
      operators: ['in', 'eq', 'ne', 'contains'],
      dynamicOptions: queryLogDynamicOptions('current_database'),
      icon: DatabaseIcon,
    },
    {
      key: 'client_name',
      column: 'client_name',
      label: 'Client',
      type: 'select',
      operators: ['in', 'contains', 'eq'],
      dynamicOptions: queryLogDynamicOptions('client_name'),
      icon: MonitorIcon,
      description: 'The client application that issued the query.',
    },
  ],
  presets: [
    {
      name: 'Last hour',
      icon: ClockIcon,
      filters: [{ key: 'event_time', operator: 'withinHours', value: '1' }],
    },
    {
      name: 'Selects only',
      icon: LayersIcon,
      filters: [{ key: 'query_kind', operator: 'in', value: 'Select' }],
    },
  ],
}
