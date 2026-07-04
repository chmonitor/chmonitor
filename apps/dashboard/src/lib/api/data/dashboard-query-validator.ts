/**
 * Dashboard Query Validator
 *
 * Validates that queries exist in the dashboard tables before execution.
 * This prevents arbitrary SQL execution from clients.
 *
 * Only queries stored in the clickhouse_monitoring_custom_dashboard table
 * are allowed to be executed without a queryConfig.
 *
 * Ported from apps/dashboard/app/api/v1/data/validators/dashboard-query-validator.ts.
 * Import paths fixed: co-located cache-manager moved alongside this file.
 * SECURITY behavior preserved exactly (fail-closed allowlist).
 *
 * @module lib/api/data/dashboard-query-validator
 */

import { getCachedDashboardQueries } from './cache-manager'
import {
  getKVCachedDashboardQueries,
  setKVCachedDashboardQueries,
} from './dashboard-query-kv-cache'
import { fetchData } from '@chm/clickhouse-client'
import { error } from '@chm/logger'
import { DASHBOARD_CHARTS_TABLE } from '@/lib/app-tables'

/** Dashboard table name for query validation */
export const DASHBOARD_QUERIES_TABLE = DASHBOARD_CHARTS_TABLE

/**
 * Validation result for dashboard queries
 */
export interface DashboardQueryValidationResult {
  readonly valid: boolean
  readonly error?: {
    readonly type: string
    readonly message: string
  }
}

/**
 * Validates that a query exists in the dashboard tables
 * Uses cache to avoid repeated lookups for the same host
 *
 * SECURITY: This prevents execution of arbitrary SQL from clients by only
 * allowing queries that have been pre-registered in the dashboard tables.
 *
 * @param query - The SQL query to validate
 * @param hostId - The host identifier to validate against
 * @returns Validation result with valid flag and optional error
 *
 * @example
 * ```ts
 * const result = await validateDashboardQuery('SELECT count() FROM system.tables', 0)
 * if (!result.valid) {
 *   return createErrorResponse(result.error!, 403)
 * }
 * ```
 */
export async function validateDashboardQuery(
  query: string,
  hostId: number
): Promise<DashboardQueryValidationResult> {
  try {
    // Check the in-memory L1 cache first to avoid repeated database queries
    const cachedQueries = getCachedDashboardQueries(hostId)
    if (cachedQueries?.has(query)) {
      return { valid: true }
    }

    // L2: Cloudflare KV cache — survives Worker isolate churn (cold starts,
    // L1 TTL expiry). A miss/error/absent-binding here is NOT a security
    // decision: it always falls through to the authoritative ClickHouse
    // lookup below, so fail-closed semantics hold regardless of KV state.
    const kvCachedQueries = await getKVCachedDashboardQueries(hostId)
    if (kvCachedQueries) {
      // Warm L1 from L2 so subsequent requests on this isolate skip KV too.
      const { updateDashboardQueryCache } = await import('./cache-manager')
      updateDashboardQueryCache(hostId, kvCachedQueries)
      if (kvCachedQueries.has(query)) {
        return { valid: true }
      }
      // Not found in the KV snapshot — fall through to the authoritative
      // ClickHouse check below (the allowlist may have changed since caching).
    }

    // Query the dashboard table to verify this query exists
    const result = await fetchData({
      query: `SELECT query FROM ${DASHBOARD_QUERIES_TABLE}`,
      format: 'JSONEachRow',
      hostId,
    })

    if (result.error) {
      // Table doesn't exist or other error - fail closed for security
      error('[Dashboard Query Validation] Error:', result.error)
      return {
        valid: false,
        error: {
          type: 'permission_error',
          message:
            'Query validation failed: dashboard table not accessible. Use /api/v1/charts/[name] or /api/v1/tables/[name] for registry-based queries.',
        },
      }
    }

    // Extract and cache queries
    const queries = new Set<string>()
    for (const row of result.data as Array<{ query: string }>) {
      queries.add(row.query)
    }

    // Update caches with the freshly validated allowlist (L1 in-memory + L2 KV)
    const { updateDashboardQueryCache } = await import('./cache-manager')
    updateDashboardQueryCache(hostId, queries)
    await setKVCachedDashboardQueries(hostId, queries)

    // Check if the query exists in the table
    if (!queries.has(query)) {
      return {
        valid: false,
        error: {
          type: 'permission_error',
          message:
            'Query not found in dashboard tables. Use /api/v1/charts/[name] or /api/v1/tables/[name] for registry-based queries.',
        },
      }
    }

    return { valid: true }
  } catch (err) {
    error('[Dashboard Query Validation] Unexpected error:', err)
    return {
      valid: false,
      error: {
        type: 'permission_error',
        message: 'Query validation failed due to an unexpected error',
      },
    }
  }
}
