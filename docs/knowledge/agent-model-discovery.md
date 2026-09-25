---
id: agent-model-discovery
title: Agent model discovery and the curated registry floor
type: spec
status: active
updated: 2026-09-26
tags:
  - ai
  - agent
  - models
  - providers
  - openrouter
  - anyrouter
  - nvidia
related:
  - agent-eval
  - agentstate-conversation-store
  - mcp-server
  - conventions
---

# Agent model discovery

`GET /api/v1/agents/models` returns the model picker list. It is built as
**one curated floor plus four additive, independently fail-soft discovery
sources**.

## The one invariant that matters

> **The curated `MODEL_REGISTRY` is the floor. Discovery is additive. A merge
> must never replace or drop a curated entry, and no upstream failure may empty
> the picker.**

Every `merge*DynamicModels` helper implements this the same way: it takes
`base` and `dynamic`, keeps every `base` id, and appends only dynamic ids not
already present. A merge test that asserts the base survives is the guard.

The second half matters just as much: **all three provider catalogs are
public**, so a successful fetch says nothing about whether the provider is
configured. `isProviderConfigured()` behind the `*_DYNAMIC_MODELS` gate is the
only authority, and `filterByConfiguredProviders()` is re-applied at the end of
`buildModels()`. Never let a fetch success imply configuration.

## The four sources

| Source | Loader | Ranking signal | Env gate | Top-N knob |
|---|---|---|---|---|
| Curated floor | `agent-model-registry.ts` | hand-curated | — | — |
| AnyRouter | `anyrouter-dynamic-models.ts` | **real usage** (`/models/{id}/metrics` → `request_count`) | `ANYROUTER_DYNAMIC_MODELS` | `ANYROUTER_TOP_MODELS_N` (8) |
| OpenRouter | `openrouter-dynamic-models.ts` | curated relevance | `OPENROUTER_DYNAMIC_MODELS` | `OPENROUTER_TOP_MODELS_N` (12) |
| NVIDIA NIM | `nvidia-dynamic-models.ts` | curated relevance | `NVIDIA_DYNAMIC_MODELS` | `NVIDIA_TOP_MODELS_N` (8) |
| AnyRouter presets | `anyrouter-presets.ts` | — | `ANYROUTER_PRESETS` | `ANYROUTER_PRESETS_MAX` |

Each loader exports the same five things, and a new provider must too:
`load<Provider>DynamicModelEntries()`, `merge<Provider>DynamicModels()`,
`is<Provider>DynamicEnabled()`, `fetch<Provider>Catalog()`, a
`__reset<Provider>DynamicCachesForTests()`, and a ranker. Cache TTL is 300s.

## Per-catalog quirks (why one ranker cannot be shared)

Each catalog exposes different metadata, so the ranker is per-provider by
necessity, not by taste.

**OpenRouter** (verified 2026-08-13) publishes the richest catalog: pricing
(**per token**, not per million — multiply by 1e6), `context_length`,
`architecture`, and `supported_parameters` (so tool-capable models *can* be
filtered). It exposes **no usage ranking** — `?order=` is accepted and ignored,
`/api/v1/models/user` needs a user token — hence "curated relevance" rather
than usage. Recency works here because `created` is real.

**AnyRouter** is the only provider with a real usage signal, but it advertises
capability via a `capabilities` field rather than `supported_parameters`.

**NVIDIA NIM** (verified 2026-09-26) is the thinnest, and every absence shapes
the loader:

- **No `supported_parameters`** → tool capability is *unknown*, not absent. It
  cannot be filtered on. `supportsTools` is reported `false` (unverified), and
  the loader drops provably non-chat categories by id instead —
  `NVIDIA_EXCLUDED_PATTERNS` (embed / guard / safety / parse / `-reward$` /
  deplot / diffusion / video / nvclip / codellama / starcoder).
- **No `context_length`** → dynamic entries use `NVIDIA_DEFAULT_CONTEXT_LENGTH`
  (128k), a documented floor. Only the registry knows a real value.
- **No `pricing`** → NVIDIA bills against API credits, so dynamic entries carry
  no pricing and the picker omits cost instead of showing a wrong `$0`.
- **`created` is the constant `735790403` (2001)** on every entry → carries no
  recency signal and **must not be used for ranking**.

Because `NVIDIA_EXCLUDED_PATTERNS` is an exclusion list, adding a pattern
*removes* a model from discovery. If a pattern starts matching a chat model,
drop the pattern rather than special-casing one id.

## Four hand-maintained lists, one test

The picker is assembled from four places that drifted independently:

1. `MODEL_REGISTRY` — the curated floor (`agent-model-registry.ts`)
2. `MODEL_PRICING` — cost estimates (`agent/analytics.ts`)
3. `CURATED_MODEL_IDS` — picker "built in vs discovered" badge
4. the registry → `provider:id` expansion in `getAllModelOptions()`

`lib/ai/__tests__/model-registry-consistency.test.ts` is the anti-drift guard
and asserts: every registry id has a pricing row; the two price tables never
disagree; free ids are zero in both; every registry id is reachable in
`CURATED_MODEL_IDS`; that set is exactly the `provider:id` pairs; and every
`entry.providers[]` value is a real provider id (a typo would otherwise
silently vanish the model, since `filterByConfiguredProviders` drops it
forever).

**Adding or removing a model means touching `MODEL_REGISTRY` *and*
`MODEL_PRICING`,** or that test fails. That is the intended workflow.

## `null` rate ≠ `$0`

`MODEL_PRICING` values are `[inputPerMillion, outputPerMillion]`, and either
slot may be `null`, meaning **no published fixed per-token rate** — a router
that bills at whatever model it picks (`openrouter/auto`), a credit-billed
provider (NVIDIA NIM), or a workspace preset (`@preset/chmonitor`).

This is deliberately distinct from `0`, which means genuinely free:

- `0` → `estimateCost` returns `0`; the picker badges the model `free`.
- `null` → `estimateCost` returns `null` ("unknown"); the picker omits cost.

Recording an unknown rate as `[0, 0]` makes a paid model report `$0.00`, which
is worse than showing nothing. Historical rows stay in `MODEL_PRICING` rather
than being pruned: a persisted conversation may still select one of them.

## `CURATED_MODEL_IDS` lives in the registry module

It is a pure derivation of `getAllModelOptions()` and lives in
`agent-model-registry.ts` (re-exported by the picker for compatibility). It
used to be defined inside `agent-model-picker.tsx`, which made the registry
depend on the component's import graph
(`picker → use-agent-model → registry`); a test importing both got
`SyntaxError: Export named 'MODEL_REGISTRY' not found`. **Do not move it back
into the component.**

## Refreshing the registry

Context lengths and prices must be **read from a live catalog, never recalled**:
`GET https://openrouter.ai/api/v1/models` is public and authoritative, and
multiply `pricing.prompt` / `pricing.completion` by 1e6. Entries with no
`pricing` need a comment saying why (credit-billed, or a rate that follows the
routed model). NVIDIA-only ids have no authoritative context source — the NIM
catalog carries none — so use the value published for the same model family and
say so in a comment.

## Gotchas

- `mock.module('@/lib/ai/agent-model-registry', …)` stubs must export
  `MODEL_REGISTRY` even when the test only cares about `getModelRegistry`. A
  real dynamic loader imports `MODEL_REGISTRY` at module load, and bun throws
  `Export named 'MODEL_REGISTRY' not found` otherwise. Symptom: an
  "Unhandled error between tests" with no failing `(fail)` line, which is easy
  to misread as a flaky suite.
- The route wraps `buildModels()` in a catch that returns **500 with the static
  list**, so "discovery failed" is a 500-with-fallback, not a 200. Test that
  shape rather than assuming a 200.
- `useAgentModel` is the client-side backstop: on a failed/empty models fetch it
  falls back to `getStaticModels()` with `configuredProviders: []`, and when a
  persisted model is no longer selectable it re-picks the first entry whose
  provider *is* configured. Both key off `available !== false`, so they are
  provider-agnostic and need no change when a provider is added.
- `LLM_EXTRA_MODELS` (`provider:modelId[|contextLength][|description]`) is the
  operator escape hatch and must keep working: `getModelRegistry()` appends
  extras, deduping by `provider:id` with the registry winning. Extras need no
  `MODEL_PRICING` row — a missing row yields `null` cost, not a wrong `0`.
- There is no `CHM_AGENT_MODEL`; the default resolves from which provider keys
  are set (`resolveDefaultAgentModel`).
