/**
 * GET /api/v1/auth/cli
 *
 * Public discovery for `chm auth login`: which auth method the CLI should use
 * (`none` | `device` | `api_key`). No secrets — enablement + hints only.
 */

import { createFileRoute } from '@tanstack/react-router'

import { resolveCliAuthDiscovery } from '@/lib/auth/cli-auth-discovery'
import { deviceCodeStoreKind } from '@/lib/auth/device-code-store'

function handleGet(): Response {
  const discovery = resolveCliAuthDiscovery()
  const store = discovery.deviceLogin.enabled
    ? deviceCodeStoreKind()
    : discovery.deviceLogin.store

  const deviceLogin = {
    enabled: discovery.deviceLogin.enabled,
    mode: discovery.deviceLogin.mode,
    deviceOnly: discovery.deviceLogin.deviceOnly,
    reason: discovery.deviceLogin.reason,
    store,
    subject: discovery.deviceLogin.deviceOnly
      ? discovery.deviceLogin.subject
      : undefined,
  }

  const payload = {
    api: discovery.api,
    authProvider: discovery.authProvider,
    deviceLogin,
    method: discovery.method,
    hint: discovery.hint,
  }

  return Response.json({ data: payload, ...payload })
}

export const Route = createFileRoute('/api/v1/auth/cli')({
  server: {
    handlers: {
      GET: async () => handleGet(),
    },
  },
})
