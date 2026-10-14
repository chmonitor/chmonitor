import { docsRoute } from './shared'
import { docs } from 'collections/server'
import { loader } from 'fumadocs-core/source'
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons'

// Primary documentation source — wraps the fumadocs-mdx generated collection.
// Base URL is the site root (docsRoute = '') so pages resolve at /getting-started etc.
export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: docsRoute || '/',
  plugins: [lucideIconsPlugin()],
})

// Convert markdown file path segments to URL slugs.
// e.g. ['getting-started.md'] → ['getting-started']
//      ['index.md']           → []
export function markdownPathToSlugs(segs: string[]) {
  if (segs.length === 0) return []
  const out = [...segs]
  out[out.length - 1] = out[out.length - 1].replace(/\.md$/, '')
  if (out.length === 1 && out[0] === 'index') out.pop()
  return out
}

// Convert URL slugs back to markdown file path.
// e.g. ['getting-started'] → { segments: ['getting-started.md'], url: '/getting-started.md' }
export function slugsToMarkdownPath(slugs: string[]) {
  const segments = [...slugs]
  if (segments.length === 0) {
    segments.push('index.md')
  } else {
    segments[segments.length - 1] += '.md'
  }
  const base = docsRoute || ''
  return {
    segments,
    url: `${base}/${segments.join('/')}`,
  }
}

// URL pattern: /og/docs/{slug...}/image.webp
export function getPageImage(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'image.webp']
  return {
    segments,
    url: `/og/docs/${segments.join('/')}`,
  }
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed')
  return `# ${page.data.title} (${page.url})\n\n${processed}`
}
