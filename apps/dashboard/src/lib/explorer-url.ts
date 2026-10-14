export function buildExplorerQueryUrl(sql: string, hostId: number): string {
  const params = new URLSearchParams()
  params.set('host', String(hostId))
  params.set('tab', 'query')
  params.set('q', btoa(encodeURIComponent(sql)))
  return `/explorer?${params.toString()}`
}
