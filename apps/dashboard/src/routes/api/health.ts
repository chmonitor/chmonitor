import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error } from '@chm/logger'
import { bridgeApiKeyEnv, isAuthenticatedRequest } from '@/lib/auth/api-guard'

function getDeploymentInfo(bindings: Record<string, string | undefined>) {
  // Determine runtime: in workerd the CLOUDFLARE_WORKERS binding is set to '1'
  const runtime = bindings.CLOUDFLARE_WORKERS === '1' ? 'cloudflare' : 'node'

  // Build-time metadata + client config are inlined via import.meta.env.VITE_*
  // (the Next NEXT_PUBLIC_* equivalent). Runtime auth comes from the worker
  // binding CHM_AUTH_PROVIDER, with the build-time VITE_AUTH_PROVIDER fallback.
  return {
    gitSha: import.meta.env.VITE_GIT_SHA || null,
    gitRef: import.meta.env.VITE_GIT_REF || null,
    buildTimestamp: import.meta.env.VITE_BUILD_TIMESTAMP || null,
    ci: import.meta.env.VITE_CI === 'true',
    runtime,
    authProvider:
      bindings.CHM_AUTH_PROVIDER ?? import.meta.env.VITE_AUTH_PROVIDER ?? null,
    clientAuthProvider: import.meta.env.VITE_AUTH_PROVIDER || null,
    agentAccess: bindings.CHM_FEATURE_AGENT_ACCESS ?? 'public',
    clerkPublishableKeyPrefix:
      import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.slice(0, 8) || null,
  }
}

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const bindings = env as Record<string, string | undefined>
          bridgeApiKeyEnv(bindings)

          const timestamp = new Date().toISOString()

          // Deployment metadata (auth posture, git info) is only returned to
          // genuinely authenticated callers. Anonymous callers get a minimal
          // liveness response so uptime probes still work without leaking
          // security posture. Uses isAuthenticatedRequest (not enforceAuth) so
          // public read-only mode — which lets anonymous users read dashboard
          // data — does NOT also expose deployment metadata (#1768).
          if (!(await isAuthenticatedRequest(request))) {
            return Response.json(
              { status: 'ok', timestamp },
              {
                status: 200,
                headers: {
                  'Content-Type': 'application/json',
                  'Cache-Control': 'no-cache, no-store, must-revalidate',
                },
              }
            )
          }

          return Response.json(
            {
              status: 'ok',
              timestamp,
              deployment: getDeploymentInfo(bindings),
            },
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
              },
            }
          )
        } catch (err) {
          error('[GET /api/health] Handler error', err as Error)

          return Response.json(
            {
              status: 'error',
              error: 'Internal server error',
              timestamp: new Date().toISOString(),
            },
            {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
              },
            }
          )
        }
      },
    },
  },
})
