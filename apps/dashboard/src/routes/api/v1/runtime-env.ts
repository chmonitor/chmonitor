/**
 * GET /api/v1/runtime-env
 *
 * Public, uncached runtime values the prerendered client shell cannot inline.
 * Today: optional `license_key` (`CHM_LICENSE_KEY`, Polar checkout id) so the
 * daily instance ping can include it on Docker/Helm without baking it into
 * the image. Honor system — missing/invalid is an empty body, never an error.
 *
 * Internal: not part of the advertised OpenAPI contract.
 */

import { createFileRoute } from '@tanstack/react-router'

import { env } from 'cloudflare:workers'
import { sanitizeLicenseKey } from '@/lib/telemetry/license-key'

type EnvBindings = Record<string, string | undefined>

function readEnv(key: string): string | undefined {
  const bindings = env as EnvBindings
  const fromBinding = bindings[key]
  if (fromBinding !== undefined && fromBinding !== '') return fromBinding
  if (typeof process !== 'undefined' && process.env) {
    const fromProcess = process.env[key]
    if (fromProcess !== undefined && fromProcess !== '') return fromProcess
  }
  return undefined
}

export const Route = createFileRoute('/api/v1/runtime-env')({
  server: {
    handlers: {
      GET: () => {
        const license_key = sanitizeLicenseKey(readEnv('CHM_LICENSE_KEY'))
        const body = license_key ? { license_key } : {}
        return Response.json(body, {
          headers: { 'Cache-Control': 'private, no-store' },
        })
      },
    },
  },
})
