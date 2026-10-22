/**
 * Effective-access computation for the Access matrix page (#4123).
 *
 * Inputs are raw rows from system.grants, system.role_grants,
 * system.settings_profiles and system.settings_profile_elements. Nothing
 * here talks to ClickHouse, so every rule is unit tested.
 *
 * Rules:
 * - A NULL database / table in system.grants means "all".
 * - Roles are followed transitively (role granted to a role), with a
 *   visited-set guard against cycles. Each privilege keeps the role path it
 *   came through.
 * - Partial revokes are per grantee: a user's REVOKE does not remove a
 *   privilege that comes from one of their roles.
 * - A `readonly = 1 | 2` settings profile caps write and admin at read.
 * - `is_wildcard` (26.7+) makes the table (or, with a NULL table, the
 *   database) a name prefix: `d1.t*` covers d1.t1 and d1.tx, not all of d1.
 * - Only a user's default roles are active at login. A grant reachable only
 *   through a non-default role is listed as "available via SET ROLE" and
 *   does not count toward the level or the readonly cap.
 */

export type AccessLevel = 'none' | 'read' | 'write' | 'admin'

export const ACCESS_LEVELS: AccessLevel[] = ['none', 'read', 'write', 'admin']

export interface GrantRow {
  user_name: string | null
  role_name: string | null
  access_type: string
  database: string | null
  table: string | null
  column: string | null
  is_partial_revoke: number | boolean
  grant_option: number | boolean
  /** 26.7+: `table` (or `database` when table is NULL) is a name prefix. */
  is_wildcard?: number | boolean
}

export interface RoleGrantRow {
  user_name: string | null
  role_name: string | null
  granted_role_name: string
  granted_role_is_default: number | boolean
  with_admin_option?: number | boolean
}

export interface SettingsProfileRow {
  name: string
  apply_to_all: number | boolean
  apply_to_list: string[]
  apply_to_except: string[]
}

export interface ProfileElementRow {
  profile_name: string | null
  user_name: string | null
  role_name: string | null
  setting_name: string | null
  value: string | null
  inherit_profile: string | null
}

export type GranteeKind = 'user' | 'role'

export interface Grantee {
  kind: GranteeKind
  name: string
}

/** A role reached from a grantee, with the path that reaches it. */
export interface RoleReach {
  role: string
  /** Grantee first, then each role in order, e.g. ['u', 'role_a', 'role_b']. */
  path: string[]
  isDefault: boolean
}

export interface AppliedPrivilege {
  accessType: string
  grantOption: boolean
  database: string | null
  table: string | null
  column: string | null
  wildcard: boolean
  /** 'direct', or the role path (grantee first). */
  source: 'direct' | string[]
}

export interface ReadonlyCap {
  value: '1' | '2'
  /** Where it came from, e.g. "profile ro (applied to writer)". */
  reason: string
}

export interface CellAccess {
  /** Level after the readonly cap. */
  level: AccessLevel
  /** Level the grants alone would give. */
  grantedLevel: AccessLevel
  viaRole: boolean
  direct: boolean
  /** A narrower REVOKE is carved out of a grant that applies here. */
  partialRevoke: boolean
  /** Some privileges only apply to some tables or columns of this scope. */
  narrowerGrants: boolean
  readonly: ReadonlyCap | null
  privileges: AppliedPrivilege[]
  /** Privileges that are carved out at a narrower scope (shown in detail). */
  revokes: AppliedPrivilege[]
  /** Level the grantee would get after SET ROLE of a non-default role. */
  setRoleLevel: AccessLevel
  /** Covering privileges reachable only through non-default roles. */
  availableViaSetRole: AppliedPrivilege[]
}

export interface AccessInputs {
  grants: GrantRow[]
  roleGrants: RoleGrantRow[]
  profiles: SettingsProfileRow[]
  profileElements: ProfileElementRow[]
}

const truthy = (v: number | boolean | null | undefined) => v === true || v === 1

// ── Privilege classification ────────────────────────────────────────────

/**
 * Only privileges that act on data in a database, table, view or dictionary
 * (system.privileges level DATABASE / TABLE / VIEW / DICTIONARY / COLUMN)
 * count. GLOBAL and access-management types (SHOW USERS, CREATE TEMPORARY
 * TABLE, ALTER USER, SYSTEM FLUSH LOGS, ...) are granted ON *.* but say
 * nothing about who can read or write a database, so they map to none.
 */
const READ_TYPES = new Set(['SELECT', 'dictGet'])

const WRITE_TYPES = new Set(['INSERT', 'TRUNCATE', 'OPTIMIZE'])

/** ALTER sub-types that manage access objects, not table data. */
const ALTER_NON_DATA = [
  'ALTER USER',
  'ALTER ROLE',
  'ALTER QUOTA',
  'ALTER ROW POLICY',
  'ALTER POLICY',
  'ALTER SETTINGS PROFILE',
  'ALTER PROFILE',
  'ALTER NAMED COLLECTION',
]

/** DDL on data objects: the grantee can create or drop them. */
const ADMIN_TYPES = new Set([
  'ALL',
  'CREATE',
  'CREATE DATABASE',
  'CREATE TABLE',
  'CREATE VIEW',
  'CREATE DICTIONARY',
  'DROP',
  'DROP DATABASE',
  'DROP TABLE',
  'DROP VIEW',
  'DROP DICTIONARY',
  'UNDROP TABLE',
])

function startsWithType(type: string, prefix: string): boolean {
  return type === prefix || type.startsWith(`${prefix} `)
}

function baseLevel(accessType: string): AccessLevel {
  if (ADMIN_TYPES.has(accessType)) return 'admin'
  if (WRITE_TYPES.has(accessType)) return 'write'
  if (
    startsWithType(accessType, 'ALTER') &&
    !ALTER_NON_DATA.some((p) => startsWithType(accessType, p))
  )
    return 'write'
  if (READ_TYPES.has(accessType)) return 'read'
  // SHOW, CHECK, SYSTEM, KILL, sources, introspection, access management:
  // not data access, so they do not raise a cell on their own.
  return 'none'
}

/**
 * Level of one access type. `grant_option` on a data privilege lifts it to
 * admin (the grantee can hand it on); on a non-data privilege it stays none.
 */
export function privilegeLevel(
  accessType: string,
  grantOption = false
): AccessLevel {
  const level = baseLevel(accessType)
  return grantOption && level !== 'none' ? 'admin' : level
}

export function maxLevel(a: AccessLevel, b: AccessLevel): AccessLevel {
  return ACCESS_LEVELS.indexOf(a) >= ACCESS_LEVELS.indexOf(b) ? a : b
}

/** A revoke of `revoked` removes `granted` when it is the same type or a parent group. */
function revokeCovers(revoked: string, granted: string): boolean {
  return startsWithType(granted, revoked)
}

// ── Scope matching ──────────────────────────────────────────────────────

export interface Scope {
  database: string
  /** Undefined for a whole-database cell. */
  table?: string
}

interface ScopedGrant {
  database: string | null
  table: string | null
  column: string | null
  wildcard: boolean
}

const scoped = (row: GrantRow): ScopedGrant => ({
  database: row.database,
  table: row.table,
  column: row.column,
  wildcard: truthy(row.is_wildcard),
})

/** `d*.*` matches by prefix; anything else names one database (NULL: all). */
function databaseMatches(g: ScopedGrant, database: string): boolean {
  if (g.database === null) return true
  return g.wildcard && g.table === null
    ? database.startsWith(g.database)
    : g.database === database
}

function tableMatches(g: ScopedGrant, table: string): boolean {
  return g.wildcard ? table.startsWith(g.table ?? '') : g.table === table
}

/** The grant covers the whole scope (NULL means all). */
function coversScope(g: ScopedGrant, scope: Scope): boolean {
  if (g.column !== null) return false
  if (!databaseMatches(g, scope.database)) return false
  if (g.table === null) return true
  return scope.table !== undefined && tableMatches(g, scope.table)
}

/** The grant applies to only part of the scope (a table or column inside it). */
function insideScope(g: ScopedGrant, scope: Scope): boolean {
  if (coversScope(g, scope)) return false
  if (g.database === null || !databaseMatches(g, scope.database)) return false
  if (scope.table === undefined) return g.table !== null || g.column !== null
  return g.column !== null && tableMatches(g, scope.table)
}

// ── Role closure ────────────────────────────────────────────────────────

/**
 * Every role reachable from a grantee, breadth first, with the shortest path.
 * Roles reachable from a default role are walked first and marked default.
 * Cycles (r1 ← r2 ← r1) stop at the first visit.
 */
export function roleClosure(
  grantee: Grantee,
  roleGrants: RoleGrantRow[]
): RoleReach[] {
  const out: RoleReach[] = []
  const visited = new Set<string>()
  if (grantee.kind === 'role') visited.add(grantee.name)

  const roots: RoleReach[] = roleGrants
    .filter((rg) =>
      grantee.kind === 'user'
        ? rg.user_name === grantee.name
        : rg.role_name === grantee.name
    )
    .map((rg) => ({
      role: rg.granted_role_name,
      path: [grantee.name, rg.granted_role_name],
      // Default roles are a user setting; every role of a role is active.
      isDefault: grantee.kind === 'role' || truthy(rg.granted_role_is_default),
    }))

  const walk = (start: RoleReach[]) => {
    let frontier = start
    while (frontier.length > 0) {
      const next: RoleReach[] = []
      for (const reach of frontier) {
        if (visited.has(reach.role)) continue
        visited.add(reach.role)
        out.push(reach)
        for (const rg of roleGrants) {
          if (rg.role_name === reach.role && !visited.has(rg.granted_role_name))
            next.push({
              role: rg.granted_role_name,
              path: [...reach.path, rg.granted_role_name],
              isDefault: reach.isDefault,
            })
        }
      }
      frontier = next
    }
  }
  // Every role active at login first, so a role that is also reachable
  // through a non-default role still counts as active.
  walk(roots.filter((r) => r.isDefault))
  walk(roots.filter((r) => !r.isDefault))
  return out
}

/** Roles and users that hold `role` directly. */
export function roleMembers(
  role: string,
  roleGrants: RoleGrantRow[]
): { kind: GranteeKind; name: string; isDefault: boolean }[] {
  return roleGrants
    .filter((rg) => rg.granted_role_name === role)
    .map((rg) => ({
      kind: (rg.user_name !== null ? 'user' : 'role') as GranteeKind,
      name: (rg.user_name ?? rg.role_name) as string,
      isDefault: truthy(rg.granted_role_is_default),
    }))
}

// ── Readonly cap ────────────────────────────────────────────────────────

function profileReadonly(
  profile: string,
  elements: ProfileElementRow[],
  visited: Set<string> = new Set()
): '1' | '2' | null {
  if (visited.has(profile)) return null
  visited.add(profile)
  let inherited: '1' | '2' | null = null
  for (const el of elements) {
    if (el.profile_name !== profile) continue
    if (el.setting_name === 'readonly') {
      // A profile's own setting wins over what it inherits.
      return normalizeReadonly(el.value)
    }
    if (el.inherit_profile && inherited === null) {
      inherited = profileReadonly(el.inherit_profile, elements, visited)
    }
  }
  return inherited
}

function normalizeReadonly(value: string | null): '1' | '2' | null {
  const v = value?.trim()
  return v === '1' || v === '2' ? v : null
}

/**
 * The readonly cap for a grantee, from its own settings, the profiles it
 * inherits, the profiles applied TO it, and the same for each of its roles.
 * The first source found is reported; any non-zero readonly caps the cell.
 */
export function resolveReadonly(
  grantee: Grantee,
  closure: RoleReach[],
  profiles: SettingsProfileRow[],
  elements: ProfileElementRow[]
): ReadonlyCap | null {
  const holders: Grantee[] = [
    grantee,
    ...closure.map((r) => ({ kind: 'role' as const, name: r.role })),
  ]

  for (const holder of holders) {
    const label = holder.name === grantee.name ? '' : ` of role ${holder.name}`
    for (const el of elements) {
      const owns =
        holder.kind === 'user'
          ? el.user_name === holder.name
          : el.role_name === holder.name
      if (!owns) continue
      if (el.setting_name === 'readonly') {
        const v = normalizeReadonly(el.value)
        if (v)
          return {
            value: v,
            reason: `readonly = ${v} set on ${holder.kind} ${holder.name}`,
          }
      }
      if (el.inherit_profile) {
        const v = profileReadonly(el.inherit_profile, elements)
        if (v)
          return {
            value: v,
            reason: `profile ${el.inherit_profile}${label} sets readonly = ${v}`,
          }
      }
    }
    for (const p of profiles) {
      const applies = truthy(p.apply_to_all)
        ? !p.apply_to_except.includes(holder.name)
        : p.apply_to_list.includes(holder.name)
      if (!applies) continue
      const v = profileReadonly(p.name, elements)
      if (v)
        return {
          value: v,
          reason: `profile ${p.name}${label} sets readonly = ${v}`,
        }
    }
  }
  return null
}

// ── Cell computation ────────────────────────────────────────────────────

export interface Sourced {
  row: GrantRow
  source: 'direct' | string[]
  /** False when the grant comes only through a non-default role. */
  active: boolean
}

/** Grant rows held by the grantee and each role in its closure. */
export function sourcedGrants(
  grantee: Grantee,
  closure: RoleReach[],
  grants: GrantRow[]
): Sourced[] {
  const own = grants
    .filter((g) =>
      grantee.kind === 'user'
        ? g.user_name === grantee.name
        : g.role_name === grantee.name
    )
    .map((row) => ({ row, source: 'direct' as const, active: true }))
  const viaRoles = closure.flatMap((reach) =>
    grants
      .filter((g) => g.role_name === reach.role)
      .map((row) => ({ row, source: reach.path, active: reach.isDefault }))
  )
  return [...own, ...viaRoles]
}

const sourceKey = (s: 'direct' | string[]) =>
  s === 'direct' ? 'direct' : s.join('←')

const toApplied = ({ row, source }: Sourced): AppliedPrivilege => ({
  accessType: row.access_type,
  grantOption: truthy(row.grant_option),
  database: row.database,
  table: row.table,
  column: row.column,
  wildcard: truthy(row.is_wildcard),
  source,
})

/**
 * Effective access for one grantee at one scope.
 *
 * `sourced` and `readonly` are passed in so the matrix computes the closure
 * once per grantee rather than once per cell.
 */
export function computeCell(
  sourced: Sourced[],
  scope: Scope,
  readonly: ReadonlyCap | null
): CellAccess {
  const privileges: AppliedPrivilege[] = []
  const revokes: AppliedPrivilege[] = []
  const availableViaSetRole: AppliedPrivilege[] = []
  let setRoleLevel: AccessLevel = 'none'
  let grantedLevel: AccessLevel = 'none'
  let partialRevoke = false
  let narrowerGrants = false

  const revokesBySource = new Map<string, Sourced[]>()
  for (const s of sourced) {
    if (!truthy(s.row.is_partial_revoke)) continue
    const key = sourceKey(s.source)
    revokesBySource.set(key, [...(revokesBySource.get(key) ?? []), s])
  }

  for (const s of sourced) {
    if (truthy(s.row.is_partial_revoke)) continue
    const g = scoped(s.row)
    const covers = coversScope(g, scope)
    const inside = insideScope(g, scope)
    if (!covers && !inside) continue

    const ownRevokes = revokesBySource.get(sourceKey(s.source)) ?? []
    const relevant = ownRevokes.filter((r) =>
      revokeCovers(r.row.access_type, s.row.access_type)
    )
    // A revoke that covers this whole scope removes the privilege here.
    if (covers && relevant.some((r) => coversScope(scoped(r.row), scope)))
      continue

    // A non-default role is off until SET ROLE: shown, never counted.
    if (!s.active) {
      if (covers) {
        availableViaSetRole.push(toApplied(s))
        setRoleLevel = maxLevel(
          setRoleLevel,
          privilegeLevel(s.row.access_type, truthy(s.row.grant_option))
        )
      }
      continue
    }

    privileges.push(toApplied(s))
    if (covers) {
      grantedLevel = maxLevel(
        grantedLevel,
        privilegeLevel(s.row.access_type, truthy(s.row.grant_option))
      )
      const carved = relevant.filter((r) => insideScope(scoped(r.row), scope))
      if (carved.length > 0) {
        partialRevoke = true
        revokes.push(...carved.map(toApplied))
      }
    } else {
      narrowerGrants = true
    }
  }

  const capped =
    readonly &&
    ACCESS_LEVELS.indexOf(grantedLevel) > ACCESS_LEVELS.indexOf('read')
  const covering = privileges.filter((p) => coversScope(p, scope))
  return {
    level: capped ? 'read' : grantedLevel,
    grantedLevel,
    viaRole: covering.some((p) => p.source !== 'direct'),
    direct: covering.some((p) => p.source === 'direct'),
    partialRevoke,
    narrowerGrants,
    readonly: capped ? readonly : null,
    privileges,
    revokes,
    setRoleLevel,
    availableViaSetRole,
  }
}

export interface GranteeAccess {
  grantee: Grantee
  closure: RoleReach[]
  readonly: ReadonlyCap | null
  sourced: Sourced[]
}

/** Per-grantee precomputation shared by every cell of its row. */
export function granteeAccess(
  grantee: Grantee,
  inputs: AccessInputs
): GranteeAccess {
  const closure = roleClosure(grantee, inputs.roleGrants)
  return {
    grantee,
    closure,
    // A readonly profile on a role that is not active does not apply.
    readonly: resolveReadonly(
      grantee,
      closure.filter((r) => r.isDefault),
      inputs.profiles,
      inputs.profileElements
    ),
    sourced: sourcedGrants(grantee, closure, inputs.grants),
  }
}

/** One-line summary, e.g. "read only: INSERT is granted through role_a, but ...". */
export function summarizeCell(cell: CellAccess): string {
  if (cell.readonly) {
    const write = cell.privileges.find(
      (p) =>
        ACCESS_LEVELS.indexOf(privilegeLevel(p.accessType, p.grantOption)) >
        ACCESS_LEVELS.indexOf('read')
    )
    const via = write
      ? write.source === 'direct'
        ? ' directly'
        : ` through ${write.source.slice(1).join(' ← ')}`
      : ''
    return `read only: ${write?.accessType ?? 'a write privilege'} is granted${via}, but ${cell.readonly.reason}.`
  }
  const setRole =
    cell.availableViaSetRole.length > 0 &&
    ACCESS_LEVELS.indexOf(cell.setRoleLevel) > ACCESS_LEVELS.indexOf(cell.level)
      ? ` ${cell.setRoleLevel} is available via SET ROLE of a non-default role.`
      : ''
  if (cell.level === 'none') {
    return `${
      cell.narrowerGrants
        ? 'no access to the whole scope; some tables or columns are granted.'
        : 'no access.'
    }${setRole}`
  }
  const parts = [`${cell.level} access`]
  if (cell.direct && cell.viaRole)
    parts.push('granted directly and through roles')
  else if (cell.viaRole) parts.push('granted through roles')
  else parts.push('granted directly')
  if (cell.partialRevoke) parts.push('with a narrower REVOKE carved out')
  return `${parts.join(', ')}.${setRole}`
}

export function formatSource(source: 'direct' | string[]): string {
  return source === 'direct' ? 'direct' : source.join(' ← ')
}
