/**
 * Anti-drift test for the three hand-maintained model lists.
 *
 * The agent model list was maintained in four places that could silently
 * diverge: `MODEL_REGISTRY` (the curated floor), `MODEL_PRICING` (cost
 * estimates), `CURATED_MODEL_IDS` (picker ordering/badges), and the picker's
 * own provider render. Adding a model to one list and forgetting another
 * produced a picker entry with no cost, or a cost with no picker entry.
 *
 * `CURATED_MODEL_IDS` is imported from the registry module, not the picker
 * component: it is a pure derivation of `getAllModelOptions()`, and importing
 * the component would pull `picker → use-agent-model → registry` into a cycle
 * with this test's own registry import.
 *
 * The rule encoded here:
 *  1. **Every registry id has a `MODEL_PRICING` row.** No row means
 *     `estimateCost` returns `null` and the picker omits cost — the blank
 *     display this test exists to prevent.
 *  2. **The two never disagree.** Where the registry declares `pricing`, the
 *     `MODEL_PRICING` row must match. A `null` row must pair with an absent
 *     `ModelEntry.pricing`, and vice versa.
 *  3. **Every registry id is reachable from the picker.** `CURATED_MODEL_IDS`
 *     is `provider:id` for every `(entry, provider)` pair, so a registry entry
 *     that names a provider typo silently vanishes from the picker.
 *  4. **Only known providers.** Every `entry.providers[]` value must be a real
 *     provider id, else `isProviderConfigured` filters the model out forever.
 */
import { describe, expect, test } from 'bun:test'
import { MODEL_PRICING } from '@/lib/ai/agent/analytics'
import {
  CURATED_MODEL_IDS,
  getAllModelOptions,
  MODEL_REGISTRY,
} from '@/lib/ai/agent-model-registry'
import { PROVIDERS } from '@/lib/ai/providers'

const KNOWN_PROVIDERS = new Set(Object.keys(PROVIDERS))

describe('MODEL_REGISTRY / MODEL_PRICING / picker stay in sync', () => {
  test('every registry id has a MODEL_PRICING row', () => {
    const missing = MODEL_REGISTRY.filter(
      (entry) => !(entry.id in MODEL_PRICING)
    ).map((entry) => entry.id)
    expect(missing).toEqual([])
  })

  test('registry pricing and MODEL_PRICING never disagree', () => {
    const mismatched: string[] = []
    for (const entry of MODEL_REGISTRY) {
      const row = MODEL_PRICING[entry.id]
      if (!row) continue // covered by the previous test
      const [inRate, outRate] = row
      if (entry.pricing) {
        if (inRate !== entry.pricing.inputPerMillion) mismatched.push(entry.id)
        else if (outRate !== entry.pricing.outputPerMillion) {
          mismatched.push(entry.id)
        }
      } else if (inRate !== null || outRate !== null) {
        // Registry says "no published rate" but the cost table charges money.
        mismatched.push(entry.id)
      }
    }
    expect(mismatched).toEqual([])
  })

  test('a free registry entry is priced at zero in both places', () => {
    for (const entry of MODEL_REGISTRY) {
      if (!isFreeRegistryId(entry.id)) continue
      const row = MODEL_PRICING[entry.id]
      expect(row).toBeDefined()
      expect(row?.[0]).toBe(0)
      expect(row?.[1]).toBe(0)
    }
  })

  test('every registry id is present in the picker set', () => {
    const expected = new Set(getAllModelOptions())
    const missing = [...expected].filter((id) => !CURATED_MODEL_IDS.has(id))
    expect(missing).toEqual([])
  })

  test('the picker set is exactly the registry provider:id pairs', () => {
    expect(CURATED_MODEL_IDS.size).toBe(getAllModelOptions().length)
  })

  test('every registry provider is a known provider id', () => {
    const unknown = new Set<string>()
    for (const entry of MODEL_REGISTRY) {
      for (const provider of entry.providers) {
        if (!KNOWN_PROVIDERS.has(provider)) unknown.add(provider)
      }
    }
    expect([...unknown]).toEqual([])
  })

  test('registry ids are unique', () => {
    const seen = new Set<string>()
    const dupes: string[] = []
    for (const entry of MODEL_REGISTRY) {
      if (seen.has(entry.id)) dupes.push(entry.id)
      seen.add(entry.id)
    }
    expect(dupes).toEqual([])
  })

  test('no MODEL_PRICING rate is negative', () => {
    const bad: string[] = []
    for (const [id, [inRate, outRate]] of Object.entries(MODEL_PRICING)) {
      if (inRate !== null && inRate < 0) bad.push(id)
      if (outRate !== null && outRate < 0) bad.push(id)
    }
    expect(bad).toEqual([])
  })
})

/** A registry id the cost table must treat as genuinely free. */
function isFreeRegistryId(id: string): boolean {
  return id === 'openrouter/free' || id.endsWith(':free')
}
