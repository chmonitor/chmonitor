/**
 * Effective custom-webhook configuration for the server sweep and settings UI.
 * D1 rows override Helm/GitOps rows by name; an explicit disabled D1 row hides
 * the Helm row until it is deleted/reset. Secret URLs stay server-side.
 */

import type {
  CustomWebhookFormat,
  CustomWebhookTarget,
  CustomWebhookTargetPublic,
} from './custom-webhook-targets'

import { loadEnvCustomWebhookTargets } from './custom-webhook-env'
import {
  type CustomWebhookTargetRow,
  isCustomWebhookStoreConfigured,
  listCustomWebhookTargets,
} from './custom-webhook-target-store'
import { redactWebhookUrl } from './custom-webhook-targets'

export interface EffectiveCustomWebhookTarget extends CustomWebhookTarget {
  source: 'd1' | 'helm'
  editable: boolean
}

export interface EffectiveCustomWebhookConfig {
  targets: EffectiveCustomWebhookTarget[]
  storage: 'ok' | 'unavailable' | 'unknown'
}

function rowToTarget(row: CustomWebhookTargetRow): CustomWebhookTarget {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: row.enabled,
    format: row.format as CustomWebhookFormat,
    minSeverity: row.minSeverity,
    titleTemplate: row.titleTemplate,
    bodyTemplate: row.bodyTemplate,
    headers: row.headers,
    updatedAt: row.updatedAt,
  }
}

/** Load and merge the effective target list without exposing credentials. */
export async function listEffectiveCustomWebhookConfig(
  ownerId: string
): Promise<EffectiveCustomWebhookConfig> {
  const envTargets = loadEnvCustomWebhookTargets()
  const d1Rows = await listCustomWebhookTargets(ownerId)
  const byName = new Map<string, EffectiveCustomWebhookTarget>()

  for (const target of envTargets) {
    byName.set(target.name, { ...target, source: 'helm', editable: false })
  }
  for (const row of d1Rows) {
    byName.set(row.name, {
      ...rowToTarget(row),
      source: 'd1',
      editable: true,
    })
  }

  return {
    targets: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    storage: isCustomWebhookStoreConfigured() ? 'ok' : 'unavailable',
  }
}

export function toPublicCustomWebhookTarget(
  target: EffectiveCustomWebhookTarget
): CustomWebhookTargetPublic {
  return {
    id: target.id,
    name: target.name,
    enabled: target.enabled,
    format: target.format,
    minSeverity: target.minSeverity,
    titleTemplate: target.titleTemplate,
    bodyTemplate: target.bodyTemplate,
    headers: target.headers,
    updatedAt: target.updatedAt,
    urlConfigured: Boolean(target.url),
    urlMasked: redactWebhookUrl(target.url),
    source: target.source,
    editable: target.editable,
  }
}
