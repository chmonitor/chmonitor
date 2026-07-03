/**
 * management-ddl.ts
 *
 * Pure functions for generating ClickHouse DDL statements for RBAC management.
 * No React; only imports `@/lib/sql-utils` (also dependency-free) — safe for
 * both server and client contexts.
 */

import { validateIdentifier } from '@/lib/sql-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wrap a ClickHouse identifier in backticks, escaping any literal backticks. */
function quoteId(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

/** Escape backslashes and single quotes in a ClickHouse string literal. */
function escapeLiteral(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

// ---------------------------------------------------------------------------
// User DDL
// ---------------------------------------------------------------------------

export type CreateUserOptions = {
  username: string
  /** If set, IDENTIFIED BY '...'; otherwise NOT IDENTIFIED */
  password?: string
  /** 'ANY' (default) omits the HOST clause; 'NONE' → HOST NONE; string → HOST IP '...' */
  host?: 'ANY' | 'NONE' | string
  defaultRole?: string
  defaultDatabase?: string
}

export function generateCreateUserDdl(opts: CreateUserOptions): string {
  const { username, password, host, defaultRole, defaultDatabase } = opts

  const parts: string[] = [`CREATE USER ${quoteId(username)}`]

  if (password) {
    parts.push(`IDENTIFIED BY '${escapeLiteral(password)}'`)
  } else {
    parts.push('NOT IDENTIFIED')
  }

  if (host === 'NONE') {
    parts.push('HOST NONE')
  } else if (host && host !== 'ANY') {
    parts.push(`HOST IP '${escapeLiteral(host)}'`)
  }
  // 'ANY' or undefined → no HOST clause (ClickHouse default is ANY HOST)

  if (defaultRole) {
    parts.push(`DEFAULT ROLE ${quoteId(defaultRole)}`)
  }

  if (defaultDatabase) {
    parts.push(`DEFAULT DATABASE ${quoteId(defaultDatabase)}`)
  }

  return parts.join(' ')
}

export type AlterUserOptions = {
  username: string
  newPassword?: string
  defaultRole?: string
  defaultDatabase?: string
}

export function generateAlterUserDdl(opts: AlterUserOptions): string {
  const { username, newPassword, defaultRole, defaultDatabase } = opts

  const parts: string[] = [`ALTER USER ${quoteId(username)}`]
  const clauses: string[] = []

  if (newPassword) {
    clauses.push(`IDENTIFIED BY '${escapeLiteral(newPassword)}'`)
  }

  if (defaultRole) {
    clauses.push(`DEFAULT ROLE ${quoteId(defaultRole)}`)
  }

  if (defaultDatabase) {
    clauses.push(`DEFAULT DATABASE ${quoteId(defaultDatabase)}`)
  }

  return parts.concat(clauses).join(' ')
}

export function generateDropUserDdl(username: string): string {
  return `DROP USER ${quoteId(username)}`
}

// ---------------------------------------------------------------------------
// Role DDL
// ---------------------------------------------------------------------------

export function generateGrantRoleDdl(role: string, toUser: string): string {
  return `GRANT ${quoteId(role)} TO ${quoteId(toUser)}`
}

export function generateRevokeRoleDdl(role: string, fromUser: string): string {
  return `REVOKE ${quoteId(role)} FROM ${quoteId(fromUser)}`
}

// ---------------------------------------------------------------------------
// Privilege DDL
// ---------------------------------------------------------------------------

export type PrivilegeTarget = {
  /** e.g. 'SELECT', 'INSERT', 'ALL' */
  privilege: string
  /** e.g. 'db.table' or '*.*' */
  on: string
  withGrantOption?: boolean
}

/**
 * Conservative pattern for a privilege keyword with an optional column list.
 * Digits are allowed after the first letter so source privileges like 'S3'
 * (under the SOURCES group, e.g. `GRANT S3 ON *.* TO user`) still validate —
 * quotes/semicolons/backticks/backslashes remain rejected either way.
 */
const PRIVILEGE_PATTERN = /^[A-Za-z][A-Za-z0-9 ]*(\([A-Za-z0-9_, ]+\))?$/

/** Validate a privilege token, e.g. 'SELECT', 'ALTER UPDATE', 'SELECT(col1, col2)'. */
function validatePrivilege(privilege: string): string {
  if (typeof privilege !== 'string' || !PRIVILEGE_PATTERN.test(privilege)) {
    throw new Error('Invalid privilege')
  }
  return privilege
}

/**
 * Validate a grant target ('*', '*.*', 'db.*', or 'db.table') and rebuild it
 * from the validated parts, quoting non-'*' parts with quoteId instead of
 * interpolating the raw string.
 */
function validateGrantTarget(on: string): string {
  if (typeof on !== 'string') {
    throw new Error('Invalid grant target')
  }
  const parts = on.split('.')
  if (parts.length > 2) {
    throw new Error('Invalid grant target')
  }
  return parts
    .map((part) => {
      if (part === '*') return '*'
      try {
        validateIdentifier(part)
      } catch {
        throw new Error('Invalid grant target')
      }
      return quoteId(part)
    })
    .join('.')
}

export function generateGrantPrivilegeDdl(
  target: PrivilegeTarget,
  toUser: string
): string {
  const { privilege, on, withGrantOption } = target
  const validPrivilege = validatePrivilege(privilege)
  const validOn = validateGrantTarget(on)
  let ddl = `GRANT ${validPrivilege} ON ${validOn} TO ${quoteId(toUser)}`
  if (withGrantOption) {
    ddl += ' WITH GRANT OPTION'
  }
  return ddl
}

export function generateRevokePrivilegeDdl(
  target: PrivilegeTarget,
  fromUser: string
): string {
  const { privilege, on } = target
  const validPrivilege = validatePrivilege(privilege)
  const validOn = validateGrantTarget(on)
  return `REVOKE ${validPrivilege} ON ${validOn} FROM ${quoteId(fromUser)}`
}

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/**
 * Check if ClickHouse RBAC management is enabled.
 * Accepts an optional env map (Worker bindings); falls back to process.env.
 */
export function isManagementEnabled(
  env?: Record<string, string | undefined>
): boolean {
  if (env && env.CLICKHOUSE_MANAGEMENT_ENABLED === 'true') return true
  if (
    typeof process !== 'undefined' &&
    process.env?.CLICKHOUSE_MANAGEMENT_ENABLED === 'true'
  )
    return true
  return false
}
