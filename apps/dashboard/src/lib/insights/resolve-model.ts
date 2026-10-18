/**
 * Server-only resolution of a user-requested insight model.
 *
 * The settings UI lets the operator pick any model from `/api/v1/agents/models`,
 * but a request could still carry a stale or unconfigured id (provider key
 * removed, typo in a deep-link, etc.). This validates the requested
 * `provider:model` against the *configured* registry and returns:
 *
 * - the requested id when it maps to a known, key-configured provider, or
 * - `undefined` to mean "use the deployment default" (`DEFAULT_MODEL`).
 *
 * Never throws — any failure resolves to the default, so generation degrades
 * gracefully rather than erroring on a bad model id.
 */

import { getModelRegistry } from '../ai/agent-model-registry'
import { isProviderConfigured } from '../ai/providers'

export function resolveInsightModel(
  requested: string | null | undefined
): string | undefined {
  const id = requested?.trim()
  if (!id) return undefined

  const colon = id.indexOf(':')
  if (colon <= 0) return undefined

  const provider = id.slice(0, colon).trim()
  const modelId = id.slice(colon + 1).trim()
  if (!provider || !modelId) return undefined

  try {
    if (!isProviderConfigured(provider)) return undefined

    const known = getModelRegistry().some(
      (entry) =>
        entry.id === modelId && (entry.providers?.includes(provider) ?? false)
    )
    return known ? id : undefined
  } catch {
    return undefined
  }
}
