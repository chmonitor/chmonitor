// Enumerate every generated doc page (content/docs/**/*.mdx) as a URL path,
// so the TanStack Start prerender can be told about all of them explicitly
// via the `pages` option.
//
// Why: the crawl-based prerender (`crawlLinks: true`, following <a href> tags
// found in rendered HTML starting from `/`) silently prerenders ONLY the
// pages it can reach. The docs landing page renders its nav client-side, so
// the raw server-rendered HTML for `/` has zero <a href> links — the crawl
// never reaches any of the 90 content pages, and a render crash on any of
// them (e.g. the TypeTable `data=` vs `type=` prop bug) never fails the
// build. Declaring every page explicitly via `pages` makes the (already
// `failOnError: true` by default) prerender step actually cover them.
//
// Must stay in sync with the slug rule in src/lib/source.ts
// (markdownPathToSlugs: drop the extension, `index` maps to the parent dir).

import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONTENT_DOCS_DIR = join(__dirname, '../content/docs')

function walkMdxFiles(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  const files = []
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...walkMdxFiles(fullPath))
    } else if (entry.endsWith('.mdx')) {
      files.push(fullPath)
    }
  }
  return files
}

function toUrlPath(mdxFilePath) {
  const rel = relative(CONTENT_DOCS_DIR, mdxFilePath).split('\\').join('/')
  const withoutExt = rel.replace(/\.mdx$/, '')
  const segments = withoutExt.split('/').filter((s) => s !== 'index')
  return `/${segments.join('/')}`
}

// Returns page entries in the shape TanStack Start's `pages` option expects,
// e.g. [{ path: '/guide/features/peerdb' }, ...]. Empty when content/docs
// hasn't been generated yet (sync-docs.mjs must run first).
export function discoverDocPages() {
  return walkMdxFiles(CONTENT_DOCS_DIR)
    .map(toUrlPath)
    .sort()
    .map((path) => ({ path }))
}
