/**
 * The host-disambiguation element of a server-data TanStack Query key.
 *
 * The request URL for a chart/table query always carries `hostId`, so for
 * server hosts (id >= 0) and the default host (`undefined`) the URL *fully*
 * identifies the response. Host-list state (e.g. `hosts.length`) must therefore
 * NOT enter the key: `useMergedHosts()` settles asynchronously, so keying on it
 * makes every server-host query fire once at `length:0`, orphan, then refetch
 * at `length:N` on first paint — duplicate network + ClickHouse load for the
 * ~28-30 overview queries, merely hidden by `placeholderData`.
 *
 * Browser connections (id < 0) are the exception. Their negative id slots are
 * reused as connections are added/removed, so `?hostId=-1` does not uniquely
 * identify the connection. The stable connection id MUST stay in the key, or a
 * new connection at the same slot could read a prior connection's cached data
 * (cross-connection leak). It returns `undefined` until the connection resolves,
 * which correctly triggers a single refetch once `useMergedHosts()` settles.
 */
export function hostConnectionKey(
  numericHostId: number | undefined,
  browserConnection: { id: string } | null | undefined
): string | undefined {
  const isBrowserConnection = numericHostId !== undefined && numericHostId < 0
  return isBrowserConnection ? browserConnection?.id : undefined
}
