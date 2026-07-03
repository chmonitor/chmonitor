/**
 * Opsgenie dispatch (transport layer).
 *
 * Applies the `Authorization: GenieKey <API_KEY>` header and the
 * region-appropriate Alert API base URL, then POSTs a create request on
 * trigger (`warning`/`critical`) or a close-alias request on `recovery`. The
 * pure body builder (`adapters/opsgenie.ts`) stays network-free; this module
 * is the only place that actually talks to Opsgenie — mirrors the
 * separation PagerDuty documents (auth/transport belongs to the dispatch
 * layer, not the adapter).
 *
 * Every outbound URL is checked with `validateHostUrl` first, the same SSRF
 * guard every other outbound fetch in this repo goes through
 * (`routes/api/v1/health/webhook.ts`, browser-connections) — even though the
 * host here is fixed by `region`, not caller input.
 *
 * Never throws: a delivery failure must not abort the health sweep loop
 * (fail-open, matching `postWebhook` in `server-sweep.ts`).
 */

import type { ResolveHostAddresses } from '@/lib/browser-connections/host-url'
import type { AlertPayload } from './adapters/types'
import type { OpsgenieRegion } from './server-alert-config'

import { buildOpsgenieBody, opsgenieAlias } from './adapters/opsgenie'
import { error } from '@chm/logger'
import { validateHostUrl } from '@/lib/browser-connections/host-url'

export interface OpsgenieDispatchConfig {
  apiKey: string
  region: OpsgenieRegion
}

/** Injectable dependencies (tests override DNS resolution + fetch). */
export interface OpsgenieDispatchDeps {
  resolveHostAddresses?: ResolveHostAddresses
  fetchImpl?: typeof fetch
}

function opsgenieBaseUrl(region: OpsgenieRegion): string {
  return region === 'eu'
    ? 'https://api.eu.opsgenie.com/v2/alerts'
    : 'https://api.opsgenie.com/v2/alerts'
}

/**
 * Dispatch one alert to Opsgenie: creates an alert for `warning`/`critical`,
 * closes the alias for `recovery`. Returns whether the request succeeded;
 * never throws.
 */
export async function dispatchOpsgenie(
  payload: AlertPayload,
  config: OpsgenieDispatchConfig,
  deps: OpsgenieDispatchDeps = {}
): Promise<boolean> {
  try {
    const baseUrl = opsgenieBaseUrl(config.region)
    const isClose = payload.severity === 'recovery'
    const url = isClose
      ? `${baseUrl}/${encodeURIComponent(opsgenieAlias(payload))}/close?identifierType=alias`
      : baseUrl

    const ssrfError = await validateHostUrl(url, deps.resolveHostAddresses)
    if (ssrfError) {
      error(
        '[health] Opsgenie dispatch blocked an unsafe URL',
        new Error(ssrfError)
      )
      return false
    }

    const body = isClose
      ? { source: 'chmonitor', note: buildOpsgenieBody(payload).message }
      : buildOpsgenieBody(payload)

    const doFetch = deps.fetchImpl ?? fetch
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `GenieKey ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        error(
          '[health] Opsgenie dispatch returned non-OK status',
          new Error(`Status ${res.status}`)
        )
      }
      return res.ok
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    error('[health] Opsgenie dispatch failed', err as Error)
    return false
  }
}
