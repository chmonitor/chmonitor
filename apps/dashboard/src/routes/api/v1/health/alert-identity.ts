/**
 * Deployment identity for browser-built test alerts
 * GET /api/v1/health/alert-identity
 *
 * The identity (`HEALTH_ALERT_INSTANCE_NAME` / `_DASHBOARD_URL` / `_METADATA`)
 * is server env, so the browser "Send test" button asks here to render the same
 * instance label, deep link and metadata a real alert carries. Non-secret.
 */

import { createFileRoute } from '@tanstack/react-router'

import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
import { buildTestAlertPayload } from '@/lib/health/test-alert-payload'

async function handleGet(request: Request): Promise<Response> {
  const permissionResponse = await authorizeFeatureRequest(
    { feature: 'settings', defaultAccess: 'authenticated', operation: 'write' },
    request,
    { allowAgentBearerToken: true }
  )
  if (permissionResponse) return permissionResponse

  const { instanceName, dashboardUrl, metadata } = buildTestAlertPayload()
  return Response.json({ instanceName, dashboardUrl, metadata })
}

export const Route = createFileRoute('/api/v1/health/alert-identity')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
    },
  },
})

export { handleGet as __handleGetForTests }
