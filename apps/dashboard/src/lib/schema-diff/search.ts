export type SchemaDiffSearch = {
  host: number
  source?: number
  target?: number
}

function parseOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isInteger(n) ? n : undefined
}

export function validateSchemaDiffSearch(
  search: Record<string, unknown>
): SchemaDiffSearch {
  const hostParsed = Number(search.host)
  const source = parseOptionalInt(search.source)
  const target = parseOptionalInt(search.target)
  return {
    host: Number.isInteger(hostParsed) ? hostParsed : 0,
    ...(source !== undefined ? { source } : {}),
    ...(target !== undefined ? { target } : {}),
  }
}
