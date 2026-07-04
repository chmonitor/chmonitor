/**
 * Native `@chm/platform` replacement for the TanStack Start / @cloudflare/vite-plugin
 * worker (aliased to `@chm/platform` in vite.config.ts + tsconfig.json).
 *
 * The upstream `@chm/platform` resolves bindings through
 * `@opennextjs/cloudflare`'s `getCloudflareContext()`, an OpenNext-only API that does
 * not exist in a TanStack Start worker (and `@opennextjs/cloudflare` is not a
 * dependency here). This shim instead reads bindings straight from the
 * `cloudflare:workers` env — which is the real Worker env on workerd and a
 * `process.env` shim on the Node/Docker build target. D1/Queue/DO access
 * therefore works on Cloudflare and degrades to `null` everywhere else (the
 * conversation store and the inbound event ingest route both fall back to their
 * non-binding path when the binding is absent).
 *
 * As of issue #2187 (PR1) this is a thin re-implementation on top of the unified
 * deploy-target module (`lib/target`): `getD1Database` / `getDurableObjectNamespace`
 * delegate to the resolved `target()` adapter, and `getQueue` uses the same
 * shared binding probe. This is a ZERO-BEHAVIOR-CHANGE refactor — the probe logic
 * (read the `cloudflare:workers` env, return the value only when it is an object)
 * is identical to the previous inline implementation on every runtime.
 * `getDurableObjectNamespace` is a NEW capability added here; existing callers of
 * `getD1Database` / `getQueue` see the same behavior and return shape.
 */
import { readBinding, target } from '@/lib/target'

export interface PlatformBindings {
  getD1Database(bindingName: string): D1Database | null
  /**
   * Get a Cloudflare Queue producer binding by name, or null when unbound
   * (self-host / local dev / no `[[queues.producers]]` in wrangler.toml yet —
   * see plans/36-inbound-event-bus-queues.md). Callers MUST treat null as "no
   * queue configured" and fall back to an inline path rather than throwing.
   */
  getQueue(bindingName: string): Queue | null
  /**
   * Get a Durable Object namespace binding by name, or null when unbound.
   * Added in issue #2187 (PR1) as a new capability on top of `lib/target`.
   */
  getDurableObjectNamespace(bindingName: string): DurableObjectNamespace | null
}

export function getPlatformBindings(): PlatformBindings {
  const adapter = target()
  return {
    getD1Database(bindingName: string): D1Database | null {
      return adapter.d1(bindingName)
    },
    // Queue is not part of the `TargetAdapter` contract (kept faithful to the
    // issue's d1/kv/durableObject interface), so use the shared binding probe
    // directly — identical behavior to the previous inline implementation.
    getQueue(bindingName: string): Queue | null {
      return readBinding<Queue>(bindingName)
    },
    getDurableObjectNamespace(
      bindingName: string
    ): DurableObjectNamespace | null {
      return adapter.durableObject(bindingName)
    },
  }
}
