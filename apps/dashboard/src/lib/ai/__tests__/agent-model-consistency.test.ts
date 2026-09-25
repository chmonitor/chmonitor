/**
 * Guards the hand-maintained model lists against each other.
 *
 * `MODEL_REGISTRY` (curated floor) and `MODEL_PRICING` (cost estimates) are
 * two separate literals that both need a row per model, and the picker
 * derives its curated list from the registry — so the pair that actually
 * drifts is registry ↔ pricing. These tests fail when they diverge, which is
 * the regression that left most registry entries rendering no cost.
 */

import { describe, expect, test } from 'bun:test'

import { MODEL_PRICING } from '@/lib/ai/agent/analytics'
import {
  getAllModelOptions,
  isFreeAgentModel,
  MODEL_REGISTRY,
} from '@/lib/ai/agent-model-registry'
import { PROVIDERS } from '@/lib/ai/providers'

/**
 * An auto-router's cost depends on the model it picks per request. Both id
 * conventions exist: `openrouter/auto` (slash) and `anyrouter:auto` (colon).
 * `…/free` routers are NOT exempt — those are genuinely $0.
 */
function isAutoRouter(id: string): boolean {
  return id === 'anyrouter:auto' || id.endsWith('/auto')
}

/**
 * Entries the deployment bills on its own key rather than through a metered
 * third party, so no per-token rate exists to record.
 */
function isOwnKey(id: string): boolean {
  return MODEL_REGISTRY.find((e) => e.id === id)?.providers.every(
    (p) => p === 'nvidia'
  )
}

/** A workspace preset is a routing alias, not a model — its cost varies. */
function isPreset(id: string): boolean {
  return id.startsWith('@preset/')
}

/** Entries that are exempt from the "must be priced" rule, and why. */
function isUnpriceable(id: string): boolean {
  return isAutoRouter(id) || isOwnKey(id) || isPreset(id)
}

describe('MODEL_REGISTRY ↔ MODEL_PRICING', () => {
  test('every metered registry entry has a pricing row', () => {
    const missing = MODEL_REGISTRY.filter(
      (entry) => !isUnpriceable(entry.id) && !(entry.id in MODEL_PRICING)
    ).map((entry) => entry.id)

    expect(missing).toEqual([])
  })

  test('registry pricing agrees with the pricing table', () => {
    const mismatched: string[] = []

    for (const entry of MODEL_REGISTRY) {
      const row = MODEL_PRICING[entry.id]
      if (!row || !entry.pricing) continue
      const [input, output] = row
      if (
        input !== entry.pricing.inputPerMillion ||
        output !== entry.pricing.outputPerMillion
      ) {
        mismatched.push(
          `${entry.id}: registry ` +
            `${entry.pricing.inputPerMillion}/${entry.pricing.outputPerMillion} ` +
            `vs table ${input}/${output}`
        )
      }
    }

    expect(mismatched).toEqual([])
  })

  test('every registry entry that advertises a price is in the table', () => {
    // The reverse direction of the agreement test: a price shown in the picker
    // must also be estimable by `estimateCost`.
    const unpriced = MODEL_REGISTRY.filter(
      (entry) => entry.pricing && !(entry.id in MODEL_PRICING)
    ).map((entry) => entry.id)

    expect(unpriced).toEqual([])
  })

  test('free entries are priced at zero', () => {
    const wrong: string[] = []

    for (const entry of MODEL_REGISTRY) {
      if (!isFreeAgentModel(entry.id)) continue
      const row = MODEL_PRICING[entry.id]
      if (!row) {
        wrong.push(`${entry.id}: free but unpriced`)
        continue
      }
      if (row[0] !== 0 || row[1] !== 0) {
        wrong.push(`${entry.id}: free but priced ${row[0]}/${row[1]}`)
      }
    }

    expect(wrong).toEqual([])
  })

  test('no table row is negative', () => {
    // OpenRouter quotes routers with a -1-per-token sentinel; a negative rate
    // must never reach a cost display.
    const negative = Object.entries(MODEL_PRICING)
      .filter(([, [input, output]]) => input < 0 || output < 0)
      .map(([id]) => id)

    expect(negative).toEqual([])
  })
})

describe('MODEL_REGISTRY ↔ provider gates', () => {
  test('every provider a registry entry names is a known provider', () => {
    // `isProviderConfigured` falls back to the OpenRouter/LLM_API_KEY path for
    // an unknown id, so a typo would show the model to the wrong deployments.
    const unknown = MODEL_REGISTRY.flatMap((entry) =>
      entry.providers
        .filter((provider) => !(provider in PROVIDERS))
        .map((provider) => `${entry.id} → ${provider}`)
    )

    expect(unknown).toEqual([])
  })

  test('no entry lists the same provider twice', () => {
    const dupes = MODEL_REGISTRY.filter(
      (entry) => new Set(entry.providers).size !== entry.providers.length
    ).map((entry) => entry.id)

    expect(dupes).toEqual([])
  })

  test('no entry is empty', () => {
    const empty = MODEL_REGISTRY.filter(
      (entry) => !entry.id || entry.providers.length === 0
    ).map((entry) => entry.id)

    expect(empty).toEqual([])
  })
})

describe('picker options', () => {
  test('every option is a well-formed provider:model id', () => {
    // `getAllModelOptions()` is the exact input the picker's CURATED_MODEL_IDS
    // is built from, and `parseModelId` splits on the first colon.
    const malformed = getAllModelOptions().filter((option) => {
      const idx = option.indexOf(':')
      return idx <= 0 || idx === option.length - 1
    })

    expect(malformed).toEqual([])
  })

  test('no duplicate provider:model options', () => {
    const options = getAllModelOptions()
    const dupes = options.filter((o, i) => options.indexOf(o) !== i)

    expect(dupes).toEqual([])
  })

  test('every option maps back to an entry listing that provider', () => {
    const orphans = getAllModelOptions().filter((option) => {
      const idx = option.indexOf(':')
      const provider = option.slice(0, idx)
      const modelId = option.slice(idx + 1)
      return !MODEL_REGISTRY.some(
        (entry) => entry.id === modelId && entry.providers.includes(provider)
      )
    })

    expect(orphans).toEqual([])
  })
})
