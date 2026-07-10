import type { SourceEngine } from '@chm/types'
import type { HostInfo } from '@chm/types/host-info'

import { useHosts } from './use-hosts'
import { useMemo } from 'react'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'
import { useBrowserConnections } from '@/lib/hooks/use-browser-connections'
import { useUserConnections } from '@/lib/hooks/use-user-connections'

/**
 * Extended host info that includes the connection source.
 *
 * - `env`      — operator-configured hosts (CLICKHOUSE_HOST). Self-hosted: real
 *                hosts, full access.
 * - `demo`     — in CLOUD mode the env hosts are a PUBLIC read-only demo shown
 *                to anonymous visitors (e.g. `duet-ubuntu`).
 * - `browser`  — connections stored in this browser (localStorage).
 * - `database` — per-user connections stored encrypted on the server (D1).
 */
export interface MergedHostInfo extends HostInfo {
  source: 'env' | 'demo' | 'browser' | 'database'
  /**
   * Source engine — WHAT kind of database this host is, orthogonal to the
   * storage-origin `source` (WHERE its credentials live). env/demo/browser
   * hosts are always `'clickhouse'`; database connections carry their stored
   * engine. Fail-closed: defaults to `'clickhouse'` everywhere.
   */
  engine: SourceEngine
  /** True for the public cloud demo — writes/agent are disabled on it. */
  readOnly?: boolean
  /** Server-stored connection UUID when source is database. */
  connectionId?: string
}

/**
 * Whether a host is backed by the server's env-configured list (addressed by
 * numeric index): `env` (self-hosted) and `demo` (cloud) both are. `browser` /
 * `database` connections carry their own credentials instead. Use this anywhere
 * that routes by host source so a `demo` host is never treated as a missing
 * connection — see resolve-host-fetch.ts and host-switcher.tsx.
 */
export function isServerHost(source: MergedHostInfo['source']): boolean {
  return source === 'env' || source === 'demo'
}

/**
 * Combines env-configured hosts with browser- and server-stored connections into
 * a unified, ordered array.
 *
 * Cloud (SaaS) mode changes how the env hosts are treated:
 *   - Anonymous visitor → env hosts surface as a read-only `demo` so the product
 *     is explorable without an account.
 *   - Signed-in user → the demo is HIDDEN ("empty it"); they see only their own
 *     browser/database connections. Zero connections drives the welcome/setup
 *     page (FirstRunGate).
 *
 * Self-hosted (default, cloud mode off) is unchanged: env hosts are `env`,
 * always shown, full access.
 *
 * @example
 * ```typescript
 * const { hosts, isLoading } = useMergedHosts()
 * ```
 */
export function useMergedHosts() {
  const { hosts: envHosts, error, isLoading, isUnauthorized } = useHosts()
  const { connections, mounted, getConnectionByHostId } =
    useBrowserConnections()
  const {
    connections: dbConnections,
    isLoading: dbLoading,
    featureEnabled: dbFeatureEnabled,
    isSignedIn,
  } = useUserConnections()

  const cloudMode = isCloudModeClient()

  // In cloud mode the env hosts are a public read-only demo, and once a user
  // signs in we hide the demo so their workspace starts empty. Self-hosted mode
  // keeps env hosts as-is for everyone.
  const envSource: MergedHostInfo['source'] = cloudMode ? 'demo' : 'env'
  const showEnvHosts = !(cloudMode && isSignedIn)

  // Memoize the derived array so the reference is stable across renders. This
  // hook is called by every chart/table data hook, so an unstable array here
  // would ripple into their memo/query-key deps and defeat those memos.
  const mergedHosts: MergedHostInfo[] = useMemo(
    () => [
      ...(showEnvHosts
        ? envHosts.map(
            (h): MergedHostInfo => ({
              ...h,
              source: envSource,
              engine: 'clickhouse',
              readOnly: cloudMode,
            })
          )
        : []),
      ...connections.map(
        (c): MergedHostInfo => ({
          id: c.hostId,
          name: c.name,
          host: c.host,
          user: c.user,
          source: 'browser',
          engine: 'clickhouse',
        })
      ),
      ...(dbFeatureEnabled && isSignedIn
        ? dbConnections.map(
            (c): MergedHostInfo => ({
              id: c.hostId,
              name: c.name,
              host: c.host,
              user: c.user,
              source: 'database',
              engine: c.engine,
              connectionId: c.id,
            })
          )
        : []),
    ],
    [
      showEnvHosts,
      envHosts,
      envSource,
      cloudMode,
      connections,
      dbFeatureEnabled,
      isSignedIn,
      dbConnections,
    ]
  )

  return {
    hosts: mergedHosts,
    error,
    // Only the env-host fetch can be unauthorized; browser connections are local.
    isUnauthorized: Boolean(isUnauthorized),
    isLoading:
      isLoading || !mounted || (dbFeatureEnabled && isSignedIn && dbLoading),
    getConnectionByHostId,
    /** Cloud SaaS mode is active for this deployment. */
    cloudMode,
    /** Whether the visitor is signed in (always false outside Clerk builds). */
    isSignedIn,
  }
}
