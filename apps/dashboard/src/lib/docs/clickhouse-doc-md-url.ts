/**
 * Converts ClickHouse HTML documentation URLs to their raw GitHub Markdown equivalents.
 *
 * Example:
 *   https://clickhouse.com/docs/operations/system-tables/disks
 *   -> https://raw.githubusercontent.com/ClickHouse/ClickHouse/refs/heads/master/docs/en/operations/system-tables/disks.md
 *
 * The `/en/` segment and `.md` suffix are injected automatically.
 * Trailing slashes in the input path are stripped before conversion.
 *
 * Returns null for URLs that are not ClickHouse documentation links.
 */

const CLICKHOUSE_DOCS_ORIGIN = 'https://clickhouse.com/docs/'
const RAW_GITHUB_BASE =
  'https://raw.githubusercontent.com/ClickHouse/ClickHouse/refs/heads/master/docs/en/'

/**
 * Converts a clickhouse.com/docs/<path> URL to its raw GitHub markdown URL.
 *
 * @param htmlUrl - The clickhouse.com docs HTML URL (with or without trailing slash,
 *                  with or without anchor fragments, with or without /en/ prefix).
 * @returns The raw GitHub markdown URL, or null if the input is not a ClickHouse docs URL.
 */
export function toClickHouseDocMarkdownUrl(htmlUrl: string): string | null {
  if (!htmlUrl.startsWith(CLICKHOUSE_DOCS_ORIGIN)) {
    return null
  }

  // Strip the base prefix to get the relative path (may include /en/ already).
  let relativePath = htmlUrl.slice(CLICKHOUSE_DOCS_ORIGIN.length)

  // Strip fragment (#anchor) — not meaningful for raw file fetches.
  const fragmentIndex = relativePath.indexOf('#')
  if (fragmentIndex !== -1) {
    relativePath = relativePath.slice(0, fragmentIndex)
  }

  relativePath = relativePath.replace(/\/+$/, '')

  // Strip a leading /en/ or en/ prefix if already present to avoid doubling it.
  if (relativePath.startsWith('en/')) {
    relativePath = relativePath.slice(3)
  }

  if (!relativePath) {
    return null
  }

  return `${RAW_GITHUB_BASE}${relativePath}.md`
}
