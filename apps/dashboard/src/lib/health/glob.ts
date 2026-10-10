/**
 * Shared `*`/`?` glob matcher — used by alert routing (`alert-routing.ts`)
 * and PeerDB mirror rules (`lib/peerdb/alert-rules.ts`). Pure, no imports, so
 * client code can use it without pulling in a store.
 */

/**
 * Convert a `*`/`?`-glob into a case-insensitive `RegExp`. `*` matches any
 * sequence (including empty), `?` matches exactly one character; everything
 * else is matched literally. A bare `*` (the common "any" case) short-circuits
 * to `/^.*$/` rather than compiling, but is handled by the caller anyway (see
 * `matchesPattern` in `alert-routing.ts`).
 */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const pattern = escaped.replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${pattern}$`, 'i')
}
