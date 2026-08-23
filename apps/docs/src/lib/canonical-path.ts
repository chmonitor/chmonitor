/** Docs URLs never use a trailing slash (except `/`). */
export function stripTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '')
  }
  return pathname
}

/** Old flat docs IA → current /guide|/operate|/reference prefixes. */
export const LEGACY_REDIRECT_PREFIX: Record<string, string> = {
  'getting-started': 'guide/getting-started',
  features: 'guide/features',
  'ai-agent': 'guide/ai-agent',
  guides: 'guide/guides',
  introduction: 'guide',
  deploy: 'operate/deploy',
  authentication: 'operate/authentication',
  advanced: 'operate/advanced',
  releases: 'reference/releases',
  migrating: 'reference/migrating',
  faq: 'reference/faq',
  settings: 'reference/settings',
}

export function legacyDocsPath(pathname: string): string | null {
  const slugs = stripTrailingSlash(pathname).split('/').filter(Boolean)
  const [first, ...rest] = slugs
  if (!first) return null
  const prefix = LEGACY_REDIRECT_PREFIX[first]
  if (!prefix) return null
  return `/${[prefix, ...rest].join('/')}`.replace(/\/$/, '') || '/'
}

/** One-hop 301 target: IA move and/or trailing slash, never a chain. */
export function docsCanonicalRedirect(pathname: string): string | null {
  if (pathname.includes('.') && !pathname.endsWith('/')) return null
  const legacy = legacyDocsPath(pathname)
  if (legacy) return legacy
  const stripped = stripTrailingSlash(pathname)
  if (stripped !== pathname) return stripped
  return null
}

export function isPreviewHost(hostname: string): boolean {
  return hostname.startsWith('preview.') || hostname.endsWith('.workers.dev')
}

export function previewRobotsTxt(): string {
  return `# Preview deployments are not the canonical docs site.
User-agent: *
Disallow: /
`
}
