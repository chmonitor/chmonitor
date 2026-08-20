/**
 * GET /api/v1/auth/device/status
 *
 * Public discovery for the `/device` page and CLI doctor: whether device login
 * is enabled, device-only (auth=none) mode, and disable reason.
 */

import { createFileRoute } from '@tanstack/react-router'

import { deviceCodeStoreKind } from '@/lib/auth/device-code-store'
import { resolveDeviceLogin } from '@/lib/auth/device-login-config'

function handleGet(): Response {
  const status = resolveDeviceLogin()
  const store = status.enabled ? deviceCodeStoreKind() : status.store
  const payload = {
    enabled: status.enabled,
    mode: status.mode,
    deviceOnly: status.deviceOnly,
    reason: status.reason,
    store,
    // Subject is useful for operators; not a secret.
    subject: status.deviceOnly ? status.subject : undefined,
  }
  return Response.json({ data: payload, ...payload })
}

export const Route = createFileRoute('/api/v1/auth/device/status')({
  server: {
    handlers: {
      GET: async () => handleGet(),
    },
  },
})
