/**
 * Cloudflare Workers target adapter (issue #2187, PR1).
 *
 * Selected when `VITE_DEPLOY_TARGET === 'cf'`. Bindings and env strings come
 * from the `cloudflare:workers` `env` via the shared, target-agnostic probes in
 * `env-access.ts`.
 */
import type { EnvSource, TargetAdapter, TargetCapabilities } from './types'

import { readBinding, readTargetEnv } from './env-access'

export class CloudflareAdapter implements TargetAdapter {
  readonly name = 'cloudflare' as const

  readonly capabilities: TargetCapabilities = {
    d1: true,
    kv: true,
    durableObject: true,
    queue: true,
  }

  env(key: string): string | undefined {
    return readTargetEnv(key)
  }

  envSource(): EnvSource {
    return 'cloudflare'
  }

  d1(bindingName: string): D1Database | null {
    return readBinding<D1Database>(bindingName)
  }

  kv(bindingName: string): KVNamespace | null {
    return readBinding<KVNamespace>(bindingName)
  }

  durableObject(bindingName: string): DurableObjectNamespace | null {
    return readBinding<DurableObjectNamespace>(bindingName)
  }
}
