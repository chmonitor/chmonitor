import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { error } from '@chm/logger'
import { bridgeApiKeyEnv, isAuthenticatedRequest } from '@/lib/auth/api-guard'
import { getAuthProvider, getBuildAuthProvider } from '@/lib/auth/provider'

function safeAuthProvider(getEnv: (key: string) => string | undefined) {
  try {
    return getAuthProvider(getEnv)
  } catch {
    return null
  }
}

function getDeploymentInfo(bindings: Record<string, string | undefined>) {
  // Determine runtime: in workerd the CLOUDFLARE_WORKERS binding is set to '1'
  const runtime = bindings.CLOUDFLARE_WORKERS === '1' ? 'cloudflare' : 'node'

  // Build-time metadata + client config are inlined via import.meta.env.VITE_*
  // (the Next NEXT_PUBLIC_* equivalent). Runtime auth comes from the worker
  // shared getAuthProvider() resolver (runtime var → runtime mode → build).
  return {
    gitSha: import.meta.env.VITE_GIT_SHA || null,
    gitRef: import.meta.env.VITE_GIT_REF || null,
    buildTimestamp: import.meta.env.VITE_BUILD_TIMESTAMP || null,
    ci: import.meta.env.VITE_CI === 'true',
    runtime,
    authProvider: safeAuthProvider((key) => bindings[key]),
    clientAuthProvider: getBuildAuthProvider(),
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
