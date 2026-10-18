/**
 * SQL identifier quoting helpers for safely interpolating table/database names
 * into ClickHouse statements (e.g. `OPTIMIZE TABLE`) that cannot use bound
 * parameters for identifiers.
 *
 * Kept dependency-free (no `cloudflare:workers` / route imports) so it is unit
 * testable and reusable across API routes.
 */

export function quoteIdent(part: string): string {
  const inner =
    part.length >= 2 && part.startsWith('`') && part.endsWith('`')
      ? part.slice(1, -1)
      : part
  return `\`${inner.replace(/`/g, '``')}\``
}

/**
 * Safely quote a (pre-validated) `db.table` / `table` / `` `quoted` `` identifier
 * so it can be interpolated into SQL. Each component is quoted independently and
 * internal backticks are escaped. Mirrors `formatQualifiedTable` in the agent
 * tools.
 */
export function quoteTableIdentifier(table: string): string {
  const t = table.trim()
  const m = t.match(
    /^(`[^`]+`|[a-zA-Z_][a-zA-Z0-9_]*)(?:\.\s*(`[^`]+`|[a-zA-Z_][a-zA-Z0-9_]*))?$/
  )
  if (!m) return quoteIdent(t)
  return m[2] ? `${quoteIdent(m[1])}.${quoteIdent(m[2])}` : quoteIdent(m[1])
}
