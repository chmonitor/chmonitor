/**
 * Native `@chm/platform` replacement for the TanStack Start / @cloudflare/vite-plugin
 * worker (aliased to `@chm/platform` in vite.config.ts + tsconfig.json).
 *
 * The upstream `@chm/platform` resolves bindings through
 * `@opennextjs/cloudflare`'s `getCloudflareContext()`, an OpenNext-only API that does
 * not exist in a TanStack Start worker (and `@opennextjs/cloudflare` is not a
 * dependency here). This shim instead reads bindings straight from the
 * `cloudflare:workers` env — which is the real Worker env on workerd and a
 * `process.env` shim on the Node/Docker build target. D1/Queue access therefore
 * works on Cloudflare and degrades to `null` everywhere else (the conversation
 * store and the inbound event ingest route both fall back to their non-binding
 * path when the binding is absent).
 */
import { env } from 'cloudflare:workers'

export interface PlatformBindings {
  getD1Database(bindingName: string): D1Database | null
  /**
   * Get a Cloudflare Queue producer binding by name, or null when unbound
   * (self-host / local dev / no `[[queues.producers]]` in wrangler.toml yet —
   * see plans/36-inbound-event-bus-queues.md). Callers MUST treat null as "no
   * queue configured" and fall back to an inline path rather than throwing.
   */
  getQueue(bindingName: string): Queue | null
}

export function getPlatformBindings(): PlatformBindings {
  return {
    getD1Database(bindingName: string): D1Database | null {
      const binding = (env as Record<string, unknown> | undefined)?.[
        bindingName
      ]
      // A real D1Database is an object on workerd; on the Node shim the value is
      // absent or a plain string, so we return null and let callers degrade.
      return binding && typeof binding === 'object'
        ? (binding as unknown as D1Database)
        : null
    },
    getQueue(bindingName: string): Queue | null {
      const binding = (env as Record<string, unknown> | undefined)?.[
        bindingName
      ]
      // A real Queue producer is an object on workerd; absent everywhere else
      // (no binding declared, Node/Docker target) — return null so callers
      // degrade to their synchronous inline path.
      return binding && typeof binding === 'object'
        ? (binding as unknown as Queue)
        : null
    },
  }
}
