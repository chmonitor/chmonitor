import type { Dispatcher, Agent as UndiciAgent } from 'undici'

import { isCloudflareWorkers } from '@chm/clickhouse-client/runtime/cloudflare-workers'
import { Address4, Address6 } from 'ip-address'
import { resolveConfig } from '@/lib/config/deployment-mode'

/**
 * Whether private / LAN / loopback / Tailscale (CGNAT) hosts may be connected.
 * Resolved from `CHM_ALLOW_PRIVATE_HOSTS`, but FORCED off in cloud mode by
 * `resolveConfig` — so the hosted multi-tenant service can never be opted into
 * SSRF-reachable internal targets. Default off; self-host opt-in only.
 */
function arePrivateHostsAllowed(): boolean {
  const env = typeof process !== 'undefined' ? process.env : {}
  return resolveConfig((k) => env[k]).allowPrivateHosts
}

const INTERNAL_ADDRESS_ERROR =
  'Connections to internal addresses are not allowed.'
const DNS_RESOLUTION_ERROR = 'Unable to resolve host safely.'
const WORKER_DNS_PINNING_ERROR =
  'Browser connection hostnames require Node.js DNS pinning. Use an IP literal or run this endpoint in a Node.js runtime.'
const DNS_LOOKUP_TIMEOUT_MS = 3000
// Keep Undici out of the Cloudflare Worker bundle; Next tracing includes it for Node standalone.
const UNDICI_PACKAGE = ['und', 'ici'].join('')

type FetchInitWithDispatcher = RequestInit & { dispatcher: Dispatcher }
type ClosableDispatcher = Dispatcher & {
  close?: () => Promise<void> | void
  destroy?: () => void
}
type UndiciModule = {
  Agent: typeof UndiciAgent
}
let undiciModulePromise: Promise<UndiciModule> | undefined

export type ResolveHostAddresses = (
  hostname: string
) => Promise<readonly string[]>

/**
 * Returns an error string if the ClickHouse host URL is invalid or internal.
 * Returns null when the host is safe to use.
 */
export async function validateHostUrl(
  host: string,
  resolveHostAddresses: ResolveHostAddresses = resolveDnsAddresses,
  allowPrivate: boolean = arePrivateHostsAllowed()
): Promise<string | null> {
  const result = await resolveValidatedHostUrl(
    host,
    resolveHostAddresses,
    allowPrivate
  )

  return typeof result === 'string' ? result : null
}

/**
 * SSRF guard for a Postgres source, the TCP-aware sibling of
 * {@link validateHostUrl}. Postgres connects over raw TCP (not HTTP), so there
 * is no URL/scheme and no fetch DNS-pinning — but the internal-target rules are
 * the SAME: reject private/loopback/link-local/CGNAT hosts unless a self-host
 * operator opted in via `CHM_ALLOW_PRIVATE_HOSTS` (forced off in cloud). It
 * shares `isInternalIp` / `resolveDnsAddresses` / `arePrivateHostsAllowed` with
 * the HTTP validator so the two engines can never drift on what "internal" means.
 *
 * `host` must be a BARE hostname or IP literal (no scheme, no path, no port —
 * the port is the separate `port` arg). Returns an error string, or `null` when
 * the target is safe to connect to.
 *
 * Residual note: `pg` re-resolves DNS at connect time, so a hostname that
 * passes here could in theory rebind to an internal IP before the socket opens
 * (a DNS-rebind TOCTOU). This mirrors the HTTP path's behaviour in the Workers
 * runtime (which also can't pin); IP-literal hosts have no such window.
 */
export async function validatePostgresHost(
  host: string,
  port: number,
  resolveHostAddresses: ResolveHostAddresses = resolveDnsAddresses,
  allowPrivate: boolean = arePrivateHostsAllowed()
): Promise<string | null> {
  const hostname = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')

  if (!hostname) {
    return 'Postgres host is required.'
  }
  if (hostname.includes('://') || /[/\s]/.test(hostname)) {
    return `Invalid Postgres host "${host}". Enter a bare hostname or IP address (e.g. db.example.com), not a URL.`
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return `Invalid Postgres port "${port}". Must be an integer between 1 and 65535.`
  }

  if (!allowPrivate) {
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      return INTERNAL_ADDRESS_ERROR
    }
    if (isInternalIp(hostname)) {
      return INTERNAL_ADDRESS_ERROR
    }
  }

  if (isIpLiteral(hostname)) {
    return null
  }

  let addresses: readonly string[]
  try {
    addresses = await resolveHostAddresses(hostname)
  } catch {
    return DNS_RESOLUTION_ERROR
  }

  if (addresses.length === 0) {
    return INTERNAL_ADDRESS_ERROR
  }
  if (!allowPrivate && addresses.some(isInternalIp)) {
    return INTERNAL_ADDRESS_ERROR
  }

  return null
}

async function resolveValidatedHostUrl(
  host: string,
  resolveHostAddresses: ResolveHostAddresses = resolveDnsAddresses,
  allowPrivate: boolean = arePrivateHostsAllowed()
): Promise<{ url: URL; addresses: readonly string[] } | string> {
  let url: URL
  try {
    url = new URL(host)
  } catch {
    return `Invalid host URL: "${host}". Must be a full URL (e.g., https://my.clickhouse.cloud:8443)`
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `Unsupported protocol "${url.protocol}". Only http and https are allowed.`
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')

  // SSRF guard: reject internal/private/loopback/CGNAT(Tailscale) targets —
  // UNLESS a self-host operator opted in via CHM_ALLOW_PRIVATE_HOSTS (never in
  // cloud). The scheme + DNS-resolution checks below stay unconditional.
  if (!allowPrivate) {
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      return INTERNAL_ADDRESS_ERROR
    }

    if (isInternalIp(hostname)) {
      return INTERNAL_ADDRESS_ERROR
    }
  }

  if (isIpLiteral(hostname)) {
    return { url, addresses: [hostname] }
  }

  let addresses: readonly string[]
  try {
    addresses = await resolveHostAddresses(hostname)
  } catch {
    return DNS_RESOLUTION_ERROR
  }

  if (!allowPrivate && addresses.some(isInternalIp)) {
    return INTERNAL_ADDRESS_ERROR
  }

  if (addresses.length === 0) {
    return INTERNAL_ADDRESS_ERROR
  }

  return { url, addresses }
}

export function createHostValidationFetch(
  resolveHostAddresses: ResolveHostAddresses = resolveDnsAddresses
): typeof fetch {
  return async (input, init) => {
    const fetchUrl = getFetchUrl(input)

    if (isCloudflareWorkers()) {
      const url = parseHttpUrl(fetchUrl)
      if (url && !isIpLiteral(getNormalizedHostname(url))) {
        throw new Error(WORKER_DNS_PINNING_ERROR)
      }
    }

    const result = await resolveValidatedHostUrl(fetchUrl, resolveHostAddresses)

    if (typeof result === 'string') {
      throw new Error(result)
    }

    if (isCloudflareWorkers()) {
      return fetch(input, init)
    }

    return fetchPinnedToValidatedAddresses(input, init, result.addresses)
  }
}

async function fetchPinnedToValidatedAddresses(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  addresses: readonly string[]
) {
  let lastError: unknown
  const addressesToTry = isIdempotentFetch(input, init)
    ? addresses
    : addresses.slice(0, 1)

  for (const address of addressesToTry) {
    let dispatcher: Dispatcher | undefined
    try {
      dispatcher = await createPinnedDispatcher(address)
      const pinnedInit = { dispatcher } satisfies FetchInitWithDispatcher
      const undiciFetch = fetch as unknown as (
        input: Parameters<typeof fetch>[0],
        init: FetchInitWithDispatcher
      ) => Promise<Response>
      const response =
        input instanceof Request
          ? await undiciFetch(new Request(input, init), pinnedInit)
          : await undiciFetch(input, {
              ...init,
              dispatcher,
            } as FetchInitWithDispatcher)

      return wrapResponseWithDispatcherCleanup(response, dispatcher)
    } catch (error) {
      if (dispatcher) {
        closeDispatcher(dispatcher)
      }
      lastError = error
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to connect to validated host addresses.')
}

function isIdempotentFetch(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1]
) {
  const method =
    init?.method ?? (input instanceof Request ? input.method : 'GET')

  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

function wrapResponseWithDispatcherCleanup(
  response: Response,
  dispatcher: Dispatcher
) {
  if (!response.body) {
    closeDispatcher(dispatcher)
    return response
  }

  const body = response.body.pipeThrough(
    new TransformStream({
      flush: () => closeDispatcher(dispatcher),
    })
  )

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function closeDispatcher(dispatcher: Dispatcher) {
  const closable = dispatcher as ClosableDispatcher
  if (typeof closable.close === 'function') {
    void Promise.resolve(closable.close()).catch(() => undefined)
    return
  }

  if (typeof closable.destroy === 'function') {
    closable.destroy()
  }
}

function getFetchUrl(input: Parameters<typeof fetch>[0]) {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url
}

function parseHttpUrl(host: string) {
  try {
    const url = new URL(host)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

async function createPinnedDispatcher(address: string) {
  const { Agent } = await loadUndici()
  const family = isAddress6(address) ? 6 : 4

  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, address, family)
      },
    },
  })
}

async function loadUndici() {
  undiciModulePromise ??= importUndici()

  return undiciModulePromise
}

async function importUndici() {
  try {
    return (await import(UNDICI_PACKAGE)) as UndiciModule
  } catch (error) {
    throw new Error('Unable to load Node fetch dispatcher for DNS pinning.', {
      cause: error,
    })
  }
}

async function resolveDnsAddresses(hostname: string) {
  const { lookup } = await import('node:dns/promises')
  const records = await withTimeout(
    lookup(hostname, { all: true, verbatim: true })
  )

  return records.map((record) => record.address)
}

function withTimeout<T>(promise: Promise<T>) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error('DNS lookup timed out')),
      DNS_LOOKUP_TIMEOUT_MS
    )
  })

  return Promise.race([promise, timeoutPromise]).finally(() =>
    timeout ? clearTimeout(timeout) : undefined
  )
}

function isIpLiteral(hostname: string) {
  return isAddress4(hostname) || isAddress6(hostname)
}

function getNormalizedHostname(url: URL) {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
}

function isAddress4(hostname: string) {
  return Address4.isValid(hostname)
}

function isAddress6(hostname: string) {
  return Address6.isValid(hostname)
}

function isInternalIp(hostname: string) {
  try {
    const address = new Address4(hostname)

    return isInternalAddress4(address)
  } catch {
    // Not IPv4.
  }

  try {
    const address = new Address6(hostname)
    const mapped4 = address.isMapped4() ? address.to4() : null

    return (
      address.isLoopback() ||
      address.isULA() ||
      address.isLinkLocal() ||
      address.isUnspecified() ||
      address.isMulticast() ||
      isInternal6to4(address) ||
      isInternalTeredo(address) ||
      (mapped4 !== null && isInternalAddress4(mapped4))
    )
  } catch {
    // Not IPv6.
  }

  return false
}

function isInternalAddress4(address: Address4) {
  return (
    address.isLoopback() ||
    address.isPrivate() ||
    address.isLinkLocal() ||
    address.isUnspecified() ||
    address.isMulticast() ||
    address.isCGNAT() ||
    address.isBroadcast()
  )
}

function isInternal6to4(address: Address6) {
  return (
    address.is6to4() &&
    isInternalAddress4(new Address4(address.inspect6to4().gateway))
  )
}

function isInternalTeredo(address: Address6) {
  return (
    address.isTeredo() &&
    isInternalAddress4(new Address4(address.inspectTeredo().client4))
  )
}
