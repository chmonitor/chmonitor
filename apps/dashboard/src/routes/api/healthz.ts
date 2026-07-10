import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
// Public client factory. We pass `web: true` so it always uses
// @clickhouse/client-web (fetch-based) and never touches the node
// @clickhouse/client (node:os/node:stream/TCP) — excluded from the worker
// bundle in vite.config.ts.
import { getClient } from '@chm/clickhouse-client'
import { error as logError, warn } from '@chm/logger'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import { detectCloudModeMismatch } from '@/lib/cloud/cloud-mode'

// Mirrors @chm/clickhouse-client getClickHouseConfigs(), but sources the
// comma-separated lists from the Cloudflare env binding (workerd does not map
// arbitrary bindings onto process.env) instead of process.env.

interface HostHealth {
  host: string
  name?: string
  status: 'up' | 'down'
  latencyMs: number
  error?: string
}

export const Route = createFileRoute('/api/healthz')({
  server: {
    handlers: {
      GET: async () => {
        const runtimeEnv = env as Record<string, string | undefined>

        // Split-brain guard: a prebuilt OSS bundle booted with a runtime cloud
        // flag makes the server enforce cloud while the client renders OSS UI.
        // Cloud mode is a build-time contract — surface the mismatch loudly.
        const cloudMode = detectCloudModeMismatch(runtimeEnv)
        if (cloudMode.mismatch) {
          warn(
            '[/api/healthz] cloud-mode split-brain: server=' +
              `${cloudMode.server} but the client bundle was built with ` +
              `cloud=${cloudMode.clientBuild}. Cloud mode is a BUILD-TIME ` +
              'contract — set CHM_CLOUD_MODE/CHM_DEPLOYMENT_MODE before the ' +
              'build (so VITE_CLOUD_MODE is inlined), not only at runtime. A ' +
              'runtime flag alone splits the product (server guards demo hosts, ' +
              'client shows OSS UI).'
          )
        }

        const configs = getClickHouseConfigsFromEnv(runtimeEnv)

        if (configs.length === 0) {
          return Response.json(
            {
              ok: false,
              error: 'No ClickHouse hosts configured',
              hosts: [],
              cloudMode,
              timestamp: new Date().toISOString(),
            },
            { status: 503 }
          )
        }

        // Per-host ping timeout (default 3s; override via CHM_HEALTHZ_TIMEOUT_MS).
        // Without an explicit abort a hung ClickHouse host stalls this readiness
        // check past the kubelet probe timeout — @clickhouse/client-web's fetch
        // otherwise waits on the TCP timeout (often >30s). Keep this BELOW the
        // chart's readinessProbe.timeoutSeconds (default 10s). abort_signal +
        // AbortSignal.timeout() are supported on both runtimes (Node 18+ and
        // workerd), so this route stays runtime-agnostic.
        const pingTimeoutMs =
          Number.parseInt(
            (env as Record<string, string | undefined>)
              .CHM_HEALTHZ_TIMEOUT_MS ?? '',
            10
          ) || 3000

        const hosts: HostHealth[] = await Promise.all(
          configs.map(async (config) => {
            const start = Date.now()
            try {
              // web: true forces the fetch-based client-web on workerd.
              const client = await getClient({
                web: true,
                clientConfig: config,
              })
              const resultSet = await client.query({
                query: 'SELECT 1',
                format: 'JSON',
                abort_signal: AbortSignal.timeout(pingTimeoutMs),
              })
              // Drain the response so the ping is a real round-trip.
              await resultSet.text()

              return {
                host: config.host,
                name: config.customName,
                status: 'up' as const,
                latencyMs: Date.now() - start,
              }
            } catch (err) {
              logError('[/api/healthz] host check failed', err as Error)
              return {
                host: config.host,
                name: config.customName,
                status: 'down' as const,
                latencyMs: Date.now() - start,
                error: 'Connection failed',
              }
            }
          })
        )

        const allUp = hosts.every((h) => h.status === 'up')

        return Response.json(
          {
            ok: allUp,
            hosts,
            cloudMode,
            timestamp: new Date().toISOString(),
          },
          { status: allUp ? 200 : 503 }
        )
      },
    },
  },
})
