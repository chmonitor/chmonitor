import type { CompareScope } from '@/lib/compare/scope'

import { parseCompareScope, parseOptionalInt } from '@/lib/compare/scope'

export type SettingsDiffSearch = {
  host: number
  source?: number
  target?: number
  scope?: CompareScope
}

export function validateSettingsDiffSearch(
  search: Record<string, unknown>
): SettingsDiffSearch {
  const hostParsed = Number(search.host)
  const source = parseOptionalInt(search.source)
  const target = parseOptionalInt(search.target)
  const scope = parseCompareScope(
    typeof search.scope === 'string' ? search.scope : undefined
  )
  return {
    host: Number.isInteger(hostParsed) ? hostParsed : 0,
    ...(source !== undefined ? { source } : {}),
    ...(target !== undefined ? { target } : {}),
    ...(scope ? { scope } : {}),
  }
}

/** Query string for GET /api/v1/settings-diff (node pair + host scope). */
export function buildSettingsDiffRequest(search: SettingsDiffSearch): string {
  const params = new URLSearchParams()
  params.set('host', String(search.host))
  if (search.scope) params.set('scope', search.scope)
  if (search.source !== undefined) params.set('source', String(search.source))
  if (search.target !== undefined) params.set('target', String(search.target))
  return `/api/v1/settings-diff?${params.toString()}`
}
