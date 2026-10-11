/**
 * Shared `?limit=` parsing. Same rule as /api/v1/health/history: a
 * non-integer or non-positive value is a client error (never silently
 * coerced); an absent/empty value yields the default; a value above `max`
 * is clamped to `max`.
 */
export type ParsedLimit =
  | { readonly ok: true; readonly value: number | undefined }
  | { readonly ok: false; readonly message: string }

export function parseLimit(
  raw: string | null,
  opts: { max: number; default?: number }
): ParsedLimit {
  if (raw === null || raw === '') return { ok: true, value: opts.default }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      ok: false,
      message: 'Invalid limit: must be a positive integer',
    }
  }
  return { ok: true, value: Math.min(parsed, opts.max) }
}
