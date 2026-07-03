/**
 * Optional ClickHouse Cloud usage/cost sync — OFF BY DEFAULT.
 *
 * Self-hosted stays whole: this module is inert unless BOTH
 * `CHM_FEATURE_CLOUD_BILLING_SYNC` is truthy AND full API credentials are
 * present. With no config it is a true no-op — no network call, no data,
 * no placeholder numbers (honest claims).
 *
 * When configured, it fetches organization usage/cost from the ClickHouse
 * Cloud API (`GET /v1/organizations/{orgId}/usageCost` — see
 * https://clickhouse.com/docs/cloud/manage/api/swagger) through the SAME
 * SSRF-guarded fetch the add-host wizard's test-connection flow uses
 * (`@/lib/browser-connections/host-url`), so this never opens a second,
 * unguarded outbound path. Results are cached briefly via the shared
 * in-memory cache (`@/lib/cache`).
 *
 * Two things are intentionally left for a follow-up once a real consumer
 * exists:
 * - The response is returned as `unknown`, not parsed into named cost
 *   fields. The exact `usageCost` JSON shape — and whether the API expects
 *   HTTP Basic auth (key id as username, key secret as password, the
 *   documented convention for ClickHouse Cloud API keys) or a Bearer token
 *   — was not verified against ClickHouse's current API reference during
 *   this change. Confirm the contract there before a consumer relies on
 *   specific fields.
 * - There is no cost-card UI or cost-aware-alert wiring yet (none existed
 *   in this codebase prior to this change) — this module is the data-layer
 *   primitive a future card/alert consumes, matching this plan's single
 *   named file target.
 *
 * Runtime note: the SSRF guard's DNS-pinning (`createHostValidationFetch`)
 * depends on Node's `node:dns`, which is unavailable on the Cloudflare
 * Workers runtime (the hosted dash.chmonitor.dev deploys there). On that
 * runtime a hostname-based fetch — including this one, since
 * api.clickhouse.cloud is a hostname, not an IP literal — fails closed with
 * a caught, reported error (`{ ok: false, error }`), never a crash and
 * never fake data. Today this sync only functions end-to-end when the app
 * runs under Node.js (self-hosted Docker/Kubernetes).
 */

import type { ResolveHostAddresses } from '@/lib/browser-connections/host-url'

import { error as logError } from '@chm/logger'
import {
  createHostValidationFetch,
  validateHostUrl,
} from '@/lib/browser-connections/host-url'
import { getMemoryCache } from '@/lib/cache'

export const CLOUD_BILLING_API_BASE_URL_DEFAULT = 'https://api.clickhouse.cloud'

/** Usage/cost data is not latency-sensitive; cache successful syncs for an hour. */
const CACHE_TTL_SECONDS = 3600

export interface CloudBillingSyncEnv {
  CHM_FEATURE_CLOUD_BILLING_SYNC?: string
  CLICKHOUSE_CLOUD_API_KEY_ID?: string
  CLICKHOUSE_CLOUD_API_KEY_SECRET?: string
  CLICKHOUSE_CLOUD_ORG_ID?: string
  /** Override for tests / regional API mirrors. Defaults to the public API. */
  CLICKHOUSE_CLOUD_API_BASE_URL?: string
}

export interface CloudBillingDateRange {
  /** `YYYY-MM-DD` */
  from: string
  /** `YYYY-MM-DD` */
  to: string
}

export type CloudBillingUsageResult =
  | { enabled: false }
  | { enabled: true; ok: true; data: unknown; fetchedAt: number }
  | { enabled: true; ok: false; error: string }

interface CloudBillingCredentials {
  keyId: string
  keySecret: string
  orgId: string
  baseUrl: string
}

function parseBoolEnv(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/**
 * Resolves full sync configuration from env, or null if the feature is off
 * or any required credential is missing. Fail-open/off by default, like
 * every other optional `CHM_FEATURE_*` gate in this codebase.
 */
function resolveCredentials(
  env: CloudBillingSyncEnv
): CloudBillingCredentials | null {
  if (!parseBoolEnv(env.CHM_FEATURE_CLOUD_BILLING_SYNC)) return null

  const keyId = env.CLICKHOUSE_CLOUD_API_KEY_ID?.trim()
  const keySecret = env.CLICKHOUSE_CLOUD_API_KEY_SECRET?.trim()
  const orgId = env.CLICKHOUSE_CLOUD_ORG_ID?.trim()
  if (!keyId || !keySecret || !orgId) return null

  const baseUrl =
    env.CLICKHOUSE_CLOUD_API_BASE_URL?.trim() ||
    CLOUD_BILLING_API_BASE_URL_DEFAULT

  return { keyId, keySecret, orgId, baseUrl }
}

/**
 * Fetch ClickHouse Cloud organization usage/cost data, if configured.
 *
 * Returns `{ enabled: false }` — a true no-op, no network call — when the
 * feature flag or credentials are missing. When configured, the endpoint is
 * validated and fetched through the shared SSRF guard; a validation or
 * network failure resolves to `{ enabled: true, ok: false, error }` rather
 * than throwing, so callers can render "no card" instead of crashing.
 *
 * @param resolveHostAddresses - injectable DNS resolver for tests (see
 * `@/lib/browser-connections/host-url`'s own test suite for the pattern);
 * defaults to real DNS resolution.
 */
export async function getCloudBillingUsage(
  env: CloudBillingSyncEnv,
  options?: {
    dateRange?: CloudBillingDateRange
    resolveHostAddresses?: ResolveHostAddresses
  }
): Promise<CloudBillingUsageResult> {
  const creds = resolveCredentials(env)
  if (!creds) return { enabled: false }

  try {
    const data = await getMemoryCache().wrap(
      () =>
        fetchUsageCost(
          creds,
          options?.dateRange,
          options?.resolveHostAddresses
        ),
      {
        key: ['ch-cloud-billing-usage-cost', creds.orgId, creds.baseUrl],
        ttlSeconds: CACHE_TTL_SECONDS,
      }
    )
    return { enabled: true, ok: true, data, fetchedAt: Date.now() }
  } catch (err) {
    logError('[ch-cloud] billing usage sync failed', err, {
      orgId: creds.orgId,
    })
    return {
      enabled: true,
      ok: false,
      error: err instanceof Error ? err.message : 'Cloud billing sync failed',
    }
  }
}

async function fetchUsageCost(
  creds: CloudBillingCredentials,
  dateRange: CloudBillingDateRange | undefined,
  resolveHostAddresses: ResolveHostAddresses | undefined
): Promise<unknown> {
  const params = new URLSearchParams()
  if (dateRange) {
    params.set('from_date', dateRange.from)
    params.set('to_date', dateRange.to)
  }
  const query = params.toString()
  const endpoint = `${creds.baseUrl}/v1/organizations/${encodeURIComponent(creds.orgId)}/usageCost${query ? `?${query}` : ''}`

  // Validate the endpoint through the exact same guard the add-host wizard
  // uses for user-supplied hosts — no second, unguarded fetch path.
  const ssrfError = await validateHostUrl(endpoint, resolveHostAddresses)
  if (ssrfError) throw new Error(ssrfError)

  const guardedFetch = createHostValidationFetch(resolveHostAddresses)
  // ClickHouse Cloud API keys are a key id / key secret pair, sent as HTTP
  // Basic auth — see the module doc comment for the caveat that this was
  // not independently re-verified during this change. btoa is available in
  // all Workers/Node/Bun runtimes this app targets (no Buffer needed).
  const token = btoa(`${creds.keyId}:${creds.keySecret}`)
  const response = await guardedFetch(endpoint, {
    headers: { Authorization: `Basic ${token}`, Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`ClickHouse Cloud API returned HTTP ${response.status}`)
  }

  return await response.json()
}
