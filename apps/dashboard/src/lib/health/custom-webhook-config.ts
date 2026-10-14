/**
 * Effective custom-webhook configuration for the server sweep and settings UI.
 * Three sources merged by `name` through the shared `mergeSources` (#3497):
 * DB rows › `channels.yaml` › `HEALTH_ALERT_WEBHOOK_TARGETS`. A D1 target
 * with the same name replaces the declarative one whole (#3539), so a
 * disabled D1 row hides the Helm target until it is deleted, and no env URL
 * or secret header leaks into a D1 target. Declarative targets are
 * read-only; secret URLs stay server-side.
 */

import type {
  CustomWebhookFormat,
  CustomWebhookTarget,
  CustomWebhookTargetPublic,
} from './custom-webhook-targets'
import type { HealthDefinitionSource, SourceLayer } from './declarative/merge'

import { buildDeclaredWebhookTarget } from './custom-webhook-env'
import {
  type CustomWebhookTargetRow,
  isCustomWebhookStoreConfigured,
  listCustomWebhookTargets,
} from './custom-webhook-target-store'
import {
  redactWebhookUrl,
  sanitizeCustomHeaders,
} from './custom-webhook-targets'
import { mergeSources } from './declarative/merge'
import { readHealthConfigLayers, warnOnce } from './declarative/sources'

export interface EffectiveCustomWebhookTarget extends CustomWebhookTarget {
  source: HealthDefinitionSource
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
  const [d1Rows, declared] = await Promise.all([
    listCustomWebhookTargets(ownerId),
    declarativeWebhookTargets(),
  ])
  return {
    targets: mergeWebhookTargets([
      ...declared,
      { source: 'd1', entries: d1Rows.map(rowToTarget) },
    ])
      .map((target) => ({ ...target, editable: target.source === 'd1' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    storage: isCustomWebhookStoreConfigured() ? 'ok' : 'unavailable',
  }
}

/**
 * Merge target layers by name: the highest source that defines a name
 * replaces the lower one whole (`time-union` shape), never field by field.
 */
export function mergeWebhookTargets(
  layers: readonly SourceLayer<CustomWebhookTarget>[]
) {
  return mergeSources(layers, (target) => target.name, 'time-union')
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
    headers: sanitizeCustomHeaders(target.headers).headers,
    updatedAt: target.updatedAt,
    urlConfigured: Boolean(target.url),
    urlMasked: redactWebhookUrl(target.url),
    source: target.source,
    editable: target.editable,
  }
}

// ---------------------------------------------------------------------------
// Declarative reader: Custom webhook targets — merge key `name`
// ---------------------------------------------------------------------------

async function declarativeWebhookTargets(): Promise<
  SourceLayer<CustomWebhookTarget>[]
> {
  return (await readHealthConfigLayers()).map((layer) => {
    if (layer.source === 'env') {
      // Already resolved and validated by `loadEnvCustomWebhookTargets`.
      return {
        source: layer.source,
        entries: Object.values(layer.data.webhookTargets),
      }
    }
    const entries: CustomWebhookTarget[] = []
    for (const t of Object.values(layer.data.webhookTargets)) {
      const target = buildDeclaredWebhookTarget({
        id: t.id,
        name: t.name,
        urlEnv: t.urlEnv,
        headersEnv: t.headersEnv,
        enabled: t.enabled,
        format: t.format,
        minSeverity: t.minSeverity,
        titleTemplate: t.titleTemplate,
        bodyTemplate: t.bodyTemplate,
        headers: t.headers,
      })
      if (target) entries.push(target)
      else {
        warnOnce(
          `[health-config] Skipping webhook target "${t.id}": env var ${t.urlEnv} is unset or not an HTTPS URL, or the entry is invalid`
        )
      }
    }
    return { source: layer.source, entries }
  })
}
