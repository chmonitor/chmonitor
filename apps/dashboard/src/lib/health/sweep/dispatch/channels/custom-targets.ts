/**
 * Custom webhook target fan-out for the sweep (feat #3414).
 *
 * Additive delivery path alongside the legacy global webhook fan-out
 * (`webhook-fanout.ts`): every ENABLED custom target whose own severity floor
 * passes receives the finding in its selected format (auto / raw-json / slack
 * / matrix), with its templates and `X-*` headers applied.
 *
 * Fail-open, like every other D1 read in the sweep: with no D1 binding (the
 * OSS default) `listCustomWebhookTargets` resolves to `[]` and this is a
 * no-op — the legacy webhook/env behavior is byte-identical. Each destination
 * URL is re-validated with the shared `validateHostUrl` SSRF guard at SEND
 * time (the API already validated at save time); a target that fails
 * validation is skipped and audited, never fetched. Full URLs are never
 * logged — only the redacted host hint.
 */

import type { AlertPayload } from '../../../adapters'
import type { AlertSeverityFloor } from '../../../alert-channel-settings'
import type { EffectiveCustomWebhookTarget } from '../../../custom-webhook-config'
import type { FindingContext } from './../finding-context'

import { resolveChannelDelivery } from '../../../alert-channel-settings'
import { listEffectiveCustomWebhookConfig } from '../../../custom-webhook-config'
import {
  buildCustomTargetBody,
  redactWebhookUrl,
  sanitizeCustomHeaders,
  sanitizeSecretHeaders,
} from '../../../custom-webhook-targets'
import { SWEEP_ROUTING_OWNER_ID } from '../../resolve-config'
import { recordChannelEvent } from './../alert-event-record'
import { postWebhook } from './../webhook-post'
import { debug } from '@chm/logger'
import { validateHostUrl } from '@/lib/browser-connections/host-url'

/**
 * Load the sweep's custom targets ONCE per tick (called from
 * `createDispatcher`, next to the other channel fallbacks). Best-effort —
 * resolves to `[]` with no D1 binding.
 */
export async function loadSweepCustomTargets(): Promise<
  EffectiveCustomWebhookTarget[]
> {
  const config = await listEffectiveCustomWebhookConfig(SWEEP_ROUTING_OWNER_ID)
  return config.targets
}

/**
 * Dispatch one finding to every eligible custom target. Returns whether ANY
 * of them delivered (the caller ORs this into the finding's `anyDelivered`).
 * Each target is gated by the shared {@link resolveChannelDelivery} resolver
 * (disabled never fires; else target floor › global floor), exactly like the
 * built-in channels.
 */
export async function dispatchCustomWebhookTargets(
  finding: FindingContext,
  params: {
    targets: readonly EffectiveCustomWebhookTarget[]
    payload: AlertPayload
    /** Pre-rendered one-line summary for the legacy `auto` path. */
    text: string
    globalMinSeverity: AlertSeverityFloor
    /**
     * The severity the finding is judged against: its own severity for an
     * alert, or the severity it recovered FROM for a recovery (same
     * convention as the sweep's `deliverSeverity`). `null` = below the
     * global floor — skip all targets.
     */
    severity: AlertSeverityFloor | null
  }
): Promise<boolean> {
  const { targets, payload, text, globalMinSeverity, severity } = params
  if (targets.length === 0 || severity === null) return false
  let anyDelivered = false

  for (const target of targets) {
    const passes = resolveChannelDelivery({
      severity,
      globalMinSeverity,
      channel: {
        enabled: target.enabled,
        ...(target.minSeverity ? { minSeverity: target.minSeverity } : {}),
      },
    })
    if (!passes) continue

    // Send-time SSRF re-validation (save-time validation lives in the API).
    // Skip + audit on failure — never fetch a target that fails the guard.
    const ssrfError = await validateHostUrl(target.url)
    if (ssrfError) {
      debug(
        `[health-sweep] skipping custom webhook target ${redactWebhookUrl(target.url)}: blocked destination`
      )
      await recordChannelEvent(finding, {
        delivered: false,
        error: 'Destination URL blocked',
        channel: `custom:${target.format}`,
      })
      continue
    }

    const safeHeaders = {
      ...sanitizeCustomHeaders(target.headers).headers,
      ...sanitizeSecretHeaders(target.secretHeaders),
    }
    const { body, adapterId } = buildCustomTargetBody(target, payload, text)
    const result = await postWebhook(target.url, body, {
      headers: safeHeaders,
      redirect: 'error',
    })
    if (result.ok) anyDelivered = true

    await recordChannelEvent(finding, {
      delivered: result.ok,
      error: result.error,
      channel: `custom:${adapterId}`,
    })
  }

  return anyDelivered
}
