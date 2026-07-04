/**
 * Node / Docker / Kubernetes target adapter (issue #2187, PR1).
 *
 * The fail-closed default — selected for every `VITE_DEPLOY_TARGET` that is not
 * `cf` (including unset/junk). Env strings come from `process.env` (via the
 * shared reader, which also tolerates the `cloudflare:workers` shim).
 *
 * `capabilities` report the platform's PRODUCTION reality: a Node/Docker/K8s
 * deploy has no Cloudflare bindings. The binding accessors still delegate to the
 * shared, target-agnostic probe rather than hard-returning `null` — this is
 * deliberate: it keeps `getPlatformBindings()` byte-for-byte identical to the
 * previous shim on EVERY runtime, notably `vite dev` (which runs on workerd with
 * `VITE_DEPLOY_TARGET` unset yet a real D1 binding present). On a genuine Node
 * build the shimmed `env` holds only strings, so the probe returns `null`.
 */
import type { EnvSource, TargetAdapter, TargetCapabilities } from './types'

import { readBinding, readTargetEnv } from './env-access'

export class NodeAdapter implements TargetAdapter {
  readonly name = 'node' as const

  readonly capabilities: TargetCapabilities = {
    d1: false,
    kv: false,
    durableObject: false,
    queue: false,
  }

  env(key: string): string | undefined {
    return readTargetEnv(key)
  }

  envSource(): EnvSource {
    return 'process'
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
