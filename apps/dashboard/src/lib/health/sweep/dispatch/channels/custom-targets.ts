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

import type { AlertBlock, AlertPayload } from '../../../adapters'
import type { AlertSeverityFloor } from '../../../alert-channel-settings'
import type { AlertDecisionKind } from '../../../alert-state-store'
import type { EffectiveCustomWebhookTarget } from '../../../custom-webhook-config'
import type { FindingContext } from './../finding-context'
import type { WebhookResult } from './../webhook-post'

import { resolveChannelDelivery } from '../../../alert-channel-settings'
import { listEffectiveCustomWebhookConfig } from '../../../custom-webhook-config'
import {
  buildCustomTargetBody,
  groupableCustomFormat,
  isHttpsCustomWebhookUrl,
  redactWebhookUrl,
  sanitizeCustomHeaders,
  sanitizeSecretHeaders,
  skipsReminder,
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

/** Whether a target's own floor (or the global one) admits this finding. */
function customTargetPasses(
  target: EffectiveCustomWebhookTarget,
  severity: AlertSeverityFloor,
  globalMinSeverity: AlertSeverityFloor
): boolean {
  return resolveChannelDelivery({
    severity,
    globalMinSeverity,
    channel: {
      enabled: target.enabled,
      ...(target.minSeverity ? { minSeverity: target.minSeverity } : {}),
    },
  })
}

/**
 * POST a built body to one custom target: send-time SSRF re-validation
 * (save-time validation lives in the API), sanitized + secret headers, and
 * `redirect: 'error'`. A blocked destination is never fetched and returns
 * `blocked: true`. Shared by the per-finding path below and the grouped flush
 * in `digest.ts`.
 */
export async function sendCustomTarget(
  target: EffectiveCustomWebhookTarget,
  body: unknown
): Promise<WebhookResult & { blocked?: true }> {
  const ssrfError = isHttpsCustomWebhookUrl(target.url)
    ? await validateHostUrl(target.url)
    : 'Custom webhook target must use HTTPS'
  if (ssrfError) {
    debug(
      `[health-sweep] skipping custom webhook target ${redactWebhookUrl(target.url)}: blocked destination`
    )
    return { ok: false, error: 'Destination URL blocked', blocked: true }
  }
  const safeHeaders = {
    ...sanitizeCustomHeaders(target.headers).headers,
    ...sanitizeSecretHeaders(target.secretHeaders),
  }
  return postWebhook(target.url, body, {
    headers: safeHeaders,
    redirect: 'error',
  })
}

/**
 * The groupable (hookshot / matrix / slack, no templates) targets that admit this
 * finding (#3869). The sweep hands these to the digest pipeline, so a sweep
 * sends one grouped message per target instead of one per finding.
 */
export function eligibleGroupableCustomTargets(params: {
  targets: readonly EffectiveCustomWebhookTarget[]
  globalMinSeverity: AlertSeverityFloor
  severity: AlertSeverityFloor | null
  decisionKind: AlertDecisionKind
}): EffectiveCustomWebhookTarget[] {
  const { targets, globalMinSeverity, severity, decisionKind } = params
  if (severity === null) return []
  return targets.filter(
    (t) =>
      groupableCustomFormat(t) !== null &&
      !skipsReminder(t, decisionKind) &&
      customTargetPasses(t, severity, globalMinSeverity)
  )
}

/**
 * Dispatch one finding to every eligible NON-groupable custom target (a
 * template or a format other than hookshot / matrix / slack). Groupable targets are
 * skipped; the digest pipeline sends them. A `repeat: false` target skips
 * reminders. Returns whether ANY delivered (the
 * caller ORs this into the finding's `anyDelivered`). Each target is gated by
 * the shared {@link resolveChannelDelivery} resolver (disabled never fires;
 * else target floor › global floor), exactly like the built-in channels.
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
    /** Resolved and sent only for targets with `details: true`. */
    alert?: () => Promise<AlertBlock>
  }
): Promise<boolean> {
  const { targets, payload, text, globalMinSeverity, severity, alert } = params
  if (targets.length === 0 || severity === null) return false
  let anyDelivered = false

  for (const target of targets) {
    if (groupableCustomFormat(target) !== null) continue
    if (skipsReminder(target, finding.decision.kind)) continue
    if (!customTargetPasses(target, severity, globalMinSeverity)) continue

    const { body, adapterId } = buildCustomTargetBody(
      target,
      target.details === true && alert
        ? { ...payload, alert: await alert() }
        : payload,
      text
    )
    const result = await sendCustomTarget(target, body)
    if (result.ok) anyDelivered = true

    await recordChannelEvent(finding, {
      delivered: result.ok,
      error: result.error,
      channel: `custom:${result.blocked ? target.format : adapterId}`,
    })
  }

  return anyDelivered
}
