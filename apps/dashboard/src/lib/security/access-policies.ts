/**
 * Row policies and quotas for the Access matrix sheets (#4123).
 *
 * Inputs are raw rows from system.row_policies, system.quotas,
 * system.quota_limits and system.quotas_usage, plus the grantee's role
 * closure from `granteeAccess`. Nothing here talks to ClickHouse.
 *
 * Rules (checked on a ClickHouse 26.5 server):
 * - A policy or quota applies when the user, or one of its active roles, is
 *   in `apply_to_list` (or `apply_to_all` is set), and neither the user nor
 *   any active role is in `apply_to_except`. A role in the EXCEPT list
 *   excludes every user that has it active.
 * - Active roles are the default roles and the roles they reach, the same set
 *   the matrix counts. Roles of a role are always active.
 * - A row policy on `db.*` has an empty `table` and covers every table of db.
 * - A user consumes ONE quota even when several apply, so assigned quotas do
 *   not stack. Usage is attributed to a user only for a quota keyed by
 *   user_name; an unkeyed quota is shared by everyone it applies to.
 */

import type { GranteeAccess, Scope } from './access-matrix'

/** The apply-to columns shared by system.row_policies and system.quotas. */
export interface ApplyToSet {
  apply_to_all: number | boolean
  apply_to_list: string[]
  apply_to_except: string[]
}

export interface RowPolicyRow extends ApplyToSet {
  name: string
  short_name: string
  database: string
  /** Empty for a `db.*` policy. */
  table: string
  select_filter: string | null
  is_restrictive: number | boolean
}

export interface QuotaRow extends ApplyToSet {
  name: string
  storage: string
  keys: string[]
  durations: number[]
}

/** UInt64 columns arrive as JSON strings; NULL means no limit. */
type Num = number | string | null

export const QUOTA_METRICS = [
  { key: 'queries', label: 'Queries' },
  { key: 'query_selects', label: 'SELECT queries' },
  { key: 'query_inserts', label: 'INSERT queries' },
  { key: 'errors', label: 'Errors' },
  { key: 'result_rows', label: 'Result rows' },
  { key: 'result_bytes', label: 'Result bytes' },
  { key: 'read_rows', label: 'Read rows' },
  { key: 'read_bytes', label: 'Read bytes' },
  { key: 'execution_time', label: 'Execution time (s)' },
  { key: 'written_bytes', label: 'Written bytes' },
  {
    key: 'failed_sequential_authentications',
    label: 'Failed sequential logins',
  },
  {
    key: 'queries_per_normalized_hash',
    label: 'Queries per normalized hash',
  },
] as const

export type QuotaMetric = (typeof QUOTA_METRICS)[number]['key']

export type QuotaLimitRow = {
  quota_name: string
  duration: number | string
  is_randomized_interval: number | boolean
} & { [K in QuotaMetric as `max_${K}`]?: Num }

export type QuotaUsageRow = {
  quota_name: string
  quota_key: string
  is_current: number | boolean
  end_time: string | null
  duration: number | string | null
} & { [K in QuotaMetric]?: Num } & { [K in QuotaMetric as `max_${K}`]?: Num }

const truthy = (v: number | boolean | null | undefined) => v === true || v === 1

/**
 * ClickHouse's apply-to match: in the list (or ALL) through the grantee or an
 * active role, and not excluded through either.
 */
export function appliesTo(set: ApplyToSet, names: string[]): boolean {
  const included =
    truthy(set.apply_to_all) || names.some((n) => set.apply_to_list.includes(n))
  return included && !names.some((n) => set.apply_to_except.includes(n))
}

/** The grantee and its active roles; with `allRoles`, as after SET ROLE ALL. */
export function matchNames(access: GranteeAccess, allRoles = false): string[] {
  return [
    access.grantee.name,
    ...access.closure.filter((r) => allRoles || r.isDefault).map((r) => r.role),
  ]
}

// ── Row policies ────────────────────────────────────────────────────────

export interface AppliedPolicy {
  name: string
  database: string
  /** Null for a `db.*` policy. */
  table: string | null
  /** The row filter, or null when the policy has none. */
  condition: string | null
  kind: 'restrictive' | 'permissive'
  /** On one table inside a whole-database cell. */
  narrower: boolean
}

export interface CellPolicies {
  applied: AppliedPolicy[]
  /** Would apply after SET ROLE of a non-default role; not in effect now. */
  viaSetRole: AppliedPolicy[]
}

function inScope(p: RowPolicyRow, scope: Scope): boolean {
  if (p.database !== scope.database) return false
  return scope.table === undefined || p.table === '' || p.table === scope.table
}

const toPolicy = (p: RowPolicyRow, scope: Scope): AppliedPolicy => ({
  name: p.short_name || p.name,
  database: p.database,
  table: p.table === '' ? null : p.table,
  condition: p.select_filter,
  kind: truthy(p.is_restrictive) ? 'restrictive' : 'permissive',
  narrower: scope.table === undefined && p.table !== '',
})

/** Row policies that filter what this grantee reads at this scope. */
export function policiesForCell(
  access: GranteeAccess,
  policies: RowPolicyRow[],
  scope: Scope
): CellPolicies {
  const active = matchNames(access)
  const all = matchNames(access, true)
  const applied: AppliedPolicy[] = []
  const viaSetRole: AppliedPolicy[] = []
  for (const p of policies) {
    if (!inScope(p, scope)) continue
    if (appliesTo(p, active)) applied.push(toPolicy(p, scope))
    else if (appliesTo(p, all)) viaSetRole.push(toPolicy(p, scope))
  }
  return { applied, viaSetRole }
}

// ── Quotas ──────────────────────────────────────────────────────────────

export interface AssignedQuota {
  name: string
  storage: string
  keys: string[]
  /** One row per interval. */
  limits: QuotaLimitRow[]
  /** Current-interval usage of this user, when it can be attributed. */
  usage: QuotaUsageRow[]
  /**
   * 'user': keyed by user_name, usage is this user's own.
   * 'shared': not keyed, usage is shared by everyone the quota applies to.
   * 'other': keyed by IP or client key, usage cannot be tied to a user.
   */
  usageKey: 'user' | 'shared' | 'other'
}

function usageKeyOf(keys: string[]): AssignedQuota['usageKey'] {
  if (keys.length === 0) return 'shared'
  return keys.length === 1 && keys[0] === 'user_name' ? 'user' : 'other'
}

/** Quotas that apply to this grantee through itself or an active role. */
export function quotasForGrantee(
  access: GranteeAccess,
  quotas: QuotaRow[],
  limits: QuotaLimitRow[],
  usage: QuotaUsageRow[]
): AssignedQuota[] {
  const names = matchNames(access)
  const isUser = access.grantee.kind === 'user'
  return quotas
    .filter((q) => appliesTo(q, names))
    .map((q) => {
      const usageKey = usageKeyOf(q.keys)
      const key =
        usageKey === 'user'
          ? access.grantee.name
          : usageKey === 'shared'
            ? ''
            : null
      return {
        name: q.name,
        storage: q.storage,
        keys: q.keys,
        limits: limits.filter((l) => l.quota_name === q.name),
        usage:
          isUser && key !== null
            ? usage.filter(
                (u) => u.quota_name === q.name && u.quota_key === key
              )
            : [],
        usageKey,
      }
    })
}

/** "1h", "30m", "1d", or seconds. */
export function formatDuration(seconds: number | string | null): string {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return '—'
  if (s % 86400 === 0) return `${s / 86400}d`
  if (s % 3600 === 0) return `${s / 3600}h`
  if (s % 60 === 0) return `${s / 60}m`
  return `${s}s`
}

/** Metrics with a limit in at least one interval of this quota. */
export function limitedMetrics(limits: QuotaLimitRow[]): QuotaMetric[] {
  return QUOTA_METRICS.map((m) => m.key).filter((k) =>
    limits.some((l) => l[`max_${k}`] !== null && l[`max_${k}`] !== undefined)
  )
}
