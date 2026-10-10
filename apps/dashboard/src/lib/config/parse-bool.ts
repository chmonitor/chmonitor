// The ONE boolean env parser. Every reader of a boolean CHM_* / VITE_* flag
// (server resolver, client feature flags, vite build, agent tool gates) uses it,
// so `=1`, `=yes` and `=true` mean the same thing everywhere.
//
// Dependency-free on purpose: vite.config.ts imports it with a relative path.

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])

/**
 * Parse a raw env string into a boolean.
 *
 * true/1/yes/on → true, false/0/no/off → false (trimmed, case-insensitive).
 * Unset, empty, or anything else → `undefined`, so callers apply their own
 * default (`parseBool(v) ?? default`). Never throws.
 */
export function parseBool(
  value: string | null | undefined
): boolean | undefined {
  if (value == null) return undefined
  const normalized = value.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return undefined
}

/**
 * Parse `CHM_CLOUD_MODE` / `VITE_CLOUD_MODE`: the shared boolean grammar plus
 * the literal `cloud`. Unset / junk → `undefined` (the caller falls back to the
 * deployment-mode default, which fails closed to oss).
 */
export function parseCloudModeFlag(
  value: string | null | undefined
): boolean | undefined {
  if (value?.trim().toLowerCase() === 'cloud') return true
  return parseBool(value)
}
