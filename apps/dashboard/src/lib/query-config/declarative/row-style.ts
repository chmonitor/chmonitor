/**
 * rowStyle compiler — Plan 02 schema-ext.
 *
 * Compiles the declarative `rowStyle` rules into a RowClassNameFn, the runtime
 * function the data-table consumes. This is the declarative replacement for a
 * hand-written rowClassName: simple, data-driven row styling expressed as an
 * ordered list of condition→className rules.
 *
 * Coercion mirrors the legacy rowClassName idioms EXACTLY so a compiled
 * function is behaviourally identical to the TS function it replaces:
 *   - numeric comparisons (gt/gte/lt/lte) and truthy/falsy use Number(v || 0)
 *   - empty/nonempty use String(v || '')
 * (Note: `|| ` not `?? ` — matches `Number(row.x || 0)` / `String(row.x || '')`
 *  used across the legacy configs, which differ from `??` for falsy values.)
 */

import type { RowClassNameFn } from '@/types/query-config'
import type { RowStyleCondition } from './schema'

type Row = Record<string, unknown>

export interface RowStyle {
  rules: { when: RowStyleCondition; className: string }[]
  default?: string
}

function compileCondition(cond: RowStyleCondition): (row: Row) => boolean {
  if ('all' in cond) {
    const subs = cond.all.map(compileCondition)
    return (row) => subs.every((f) => f(row))
  }
  if ('any' in cond) {
    const subs = cond.any.map(compileCondition)
    return (row) => subs.some((f) => f(row))
  }

  const { column } = cond
  switch (cond.op) {
    case 'gt': {
      const v = cond.value
      return (row) => Number(row[column] || 0) > v
    }
    case 'gte': {
      const v = cond.value
      return (row) => Number(row[column] || 0) >= v
    }
    case 'lt': {
      const v = cond.value
      return (row) => Number(row[column] || 0) < v
    }
    case 'lte': {
      const v = cond.value
      return (row) => Number(row[column] || 0) <= v
    }
    case 'truthy':
      return (row) => Number(row[column] || 0) !== 0
    case 'falsy':
      return (row) => Number(row[column] || 0) === 0
    case 'nonempty':
      return (row) => String(row[column] || '') !== ''
    case 'empty':
      return (row) => String(row[column] || '') === ''
  }
}

/**
 * Compile declarative rowStyle rules into a RowClassNameFn. The first matching
 * rule's className is returned; if none match, `default` (or undefined).
 */
export function compileRowStyle(rowStyle: RowStyle): RowClassNameFn {
  const compiled = rowStyle.rules.map((rule) => ({
    test: compileCondition(rule.when),
    className: rule.className,
  }))
  const fallback = rowStyle.default
  return (row) => {
    for (const rule of compiled) {
      if (rule.test(row)) return rule.className
    }
    return fallback
  }
}
