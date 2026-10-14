/**
 * Detect Cloudflare Workers without importing server-only ClickHouse clients.
 */
export function isCloudflareWorkers(): boolean {
  if (
    typeof process !== 'undefined' &&
    (process.env.CF_PAGES || process.env.CLOUDFLARE_WORKERS === '1')
  ) {
    return true
  }

  return (
    (typeof caches !== 'undefined' || hasWorkersGlobals()) &&
    typeof process === 'undefined'
  )
}

/**
 * True when Workers-only globals exist. Read via Reflect so this compiles both
 * with and without `@cloudflare/workers-types` in scope.
 */
export function hasWorkersGlobals(): boolean {
  return (
    typeof Reflect.get(globalThis, 'WebSocketPair') !== 'undefined' ||
    typeof Reflect.get(globalThis, 'DurableObject') !== 'undefined'
  )
}
