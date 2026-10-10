/**
 * Schema-driven filter system types.
 *
 * A {@link FilterSchema} is attached to a `QueryConfig` and declaratively
 * describes which columns can be filtered, with which operators, and how the
 * filter UI should render the value editor. The server turns active filters
 * into a parameterized `WHERE` clause — column names and operators come only
 * from this trusted schema, never from user input.
 */

import type { Icon } from '@chm/types/icon'

/** Comparison operators a filter field can use. */
export type FilterOperator =
  | 'eq' // equals
  | 'ne' // not equals
  | 'contains' // case-insensitive substring match
  | 'notContains' // case-insensitive substring exclusion
  | 'in' // value is one of a list
  | 'notIn' // value is not in a list
  | 'gt' // greater than
  | 'gte' // greater than or equal
  | 'lt' // less than
  | 'lte' // less than or equal
  | 'between' // within an inclusive range (two values)
  | 'withinHours' // event happened within the last N hours

/** UI input type used to render a filter field's value editor. */
export type FilterFieldType = 'text' | 'number' | 'select' | 'datetime'

/** A selectable option for `select` fields. */
export interface FilterFieldOption {
  label: string
  value: string
}

/**
 * Source for loading `select` options dynamically from ClickHouse.
 * Both `table` and `column` come from the trusted schema, never user input.
 */
export interface FilterFieldDynamicOptions {
  /** Fully-qualified system table, e.g. `system.query_log`. */
  table: string
  /** Column to pull DISTINCT values from. */
  column: string
  /** Optional bound to keep the lookup cheap, e.g. a recent time window. */
  where?: string
}

/** A concrete operator + value applied to a field's default condition. */
export interface FilterValue {
  operator: FilterOperator
  /** Comma-joined raw value (multi-value operators hold several entries). */
  value: string
}

/** Definition of a single filterable field. */
export interface FilterField {
  /** Stable identifier — also used as the URL query-param name. */
  key: string
  /** ClickHouse column name or SQL expression the condition applies to. */
  column: string
  /** Human-readable label shown in the UI. */
  label: string
  /** Input type used to render the value editor. */
  type: FilterFieldType
  /** Allowed operators; the first entry is the default. */
  operators: [FilterOperator, ...FilterOperator[]]
  /** Static options for `select` fields. */
  options?: FilterFieldOption[]
  /** Load `select` options from ClickHouse at runtime. */
  dynamicOptions?: FilterFieldDynamicOptions
  /** Icon shown next to the field. */
  icon?: Icon
  /** Placeholder for text / number inputs. */
  placeholder?: string
  /** Unit suffix shown in the input (e.g. `MB`, `rows`, `s`). */
  unit?: string
  /**
   * Multiplier applied to a numeric value before it reaches ClickHouse.
   * e.g. `scale: 1048576` converts an MB input into bytes.
   */
  scale?: number
  /** Short hint shown under the field in the editor. */
  description?: string
  /**
   * Condition applied when the field has no value in the URL. Useful for
   * defaults such as excluding service users. An explicit empty URL value
   * (`?key=`) overrides this back to "no filter".
   */
  defaultValue?: FilterValue
  /**
   * Minimum ClickHouse version (e.g. `'26.6'`) whose SQL selects this column.
   * The filter bar hides the field on older servers, so it cannot offer a
   * filter on a column the query does not return.
   */
  since?: string
}

/** A one-click bundle of filters. */
export interface FilterPreset {
  /** Label shown in the presets menu. */
  name: string
  icon?: Icon
  /** Filters applied together when the preset is selected. */
  filters: (FilterValue & { key: string })[]
}

/** Quick filter display type. */
export type QuickFilterDisplay = 'segmented' | 'select'

/**
 * Quick filter: always-visible inline control for high-value filters.
 * Renders before filter chips in the FilterBar.
 */
export interface QuickFilterConfig {
  /** Field key from fields[] that this quick filter controls. */
  key: string
  /** How to render the inline control. */
  display: QuickFilterDisplay
  /** Override label (defaults to field.label). */
  label?: string
  /**
   * For segmented: options to show.
   * Defaults to field.options (for select-type fields) or needs explicit options.
   */
  options?: { label: string; value: string }[]
  /**
   * For segmented: include an "All" option that clears the filter.
   * When true, prepends { label: 'All', value: '' } to options.
   */
  includeAll?: boolean
  /** Optional icon shown with the control. */
  icon?: Icon
}

/** Declarative filter configuration attached to a `QueryConfig`. */
export interface FilterSchema {
  /** Filterable fields rendered in the filter bar. */
  fields: FilterField[]
  /** Optional one-click filter bundles. */
  presets?: FilterPreset[]
  /**
   * Always-visible inline controls for high-value filters.
   * Renders before filter chips in the FilterBar.
   */
  quickFilters?: QuickFilterConfig[]
}

/** A filter with a concrete operator + value, parsed from the URL. */
export interface ActiveFilter {
  key: string
  operator: FilterOperator
  /** Raw value(s). Multi-value operators (`in`, `between`) hold >1 entry. */
  values: string[]
}
