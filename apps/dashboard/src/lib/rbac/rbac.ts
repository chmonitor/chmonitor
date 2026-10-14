// RBAC scaffold — community is single-operator all-access; enforcement is
// enterprise-gated; fail-open to free (any ambiguity → allow).
//
// Community edition never gates anything. RBAC enforcement only activates
// when edition=enterprise AND the 'rbac' feature flag is enabled. Outside
// that narrow condition every hasPermission / canPerform call returns true.

import { isEnabled } from '@/lib/edition'

// Coarse permission set that mirrors the app's actual action surface.
// Expand as needed; the guard logic is O(1) regardless of set size.

export type Permission =
  | 'query:read' // View queries, query log, running queries
  | 'query:kill' // Kill running queries
  | 'config:write' // Modify settings / connection config
  | 'cluster:admin' // Cluster-level operations (scaling, topology changes)
  | 'table:read' // Browse tables, schemas, data explorer
  | 'table:write' // DDL / DML modifications
  | 'metric:read' // View metrics, charts, health panels
  | 'insight:write' // Create / dismiss AI insights

export type Role = {
  id: string
  name: string
  /** '*' grants all permissions; an explicit array is an allow-list. */
  permissions: readonly Permission[] | '*'
}

/**
 * The community single-operator role.
 *
 * Community (OSS) installs are single-operator: one person manages the whole
 * ClickHouse cluster, so every permission is implicitly granted. This role is
 * the default; it is also what enterprise resolves to when no role is provided,
 * preserving the fail-open guarantee.
 */
export const COMMUNITY_ROLE: Role = {
  id: 'operator',
  name: 'Operator',
  permissions: '*',
}

/**
 * Pure guard: does the given role grant the requested permission?
 *
 * - `'*'` permissions → always true (wildcard / all-access).
 * - Explicit array → true iff the permission appears in it.
 *
 * Does NOT consult the edition; use `canPerform` for that.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  if (role.permissions === '*') return true
  return role.permissions.includes(permission)
}

/**
 * Application-level guard.
 *
 * Fail-open design:
 *   1. If RBAC is not enabled for this edition → true (community all-access).
 *   2. If an unexpected error occurs at any point → true (safe default).
 *   3. If no role is supplied → fall back to COMMUNITY_ROLE (all-access).
 *
 * @param permission    The permission to check.
 * @param opts.role       Role to evaluate (defaults to COMMUNITY_ROLE).
 * @param opts.runtimeEnv Cloudflare Worker `env` binding or process.env override;
 *                        forwarded to isEnabled for edition resolution.
 */
export function canPerform(
  permission: Permission,
  opts?: { role?: Role; runtimeEnv?: Record<string, string | undefined> }
): boolean {
  try {
    if (!isEnabled('rbac', opts?.runtimeEnv)) {
      // Community / feature-disabled → unconditionally allow.
      return true
    }
    return hasPermission(opts?.role ?? COMMUNITY_ROLE, permission)
  } catch {
    // Unexpected error (e.g. import resolution failure in an edge case) → allow.
    return true
  }
}
