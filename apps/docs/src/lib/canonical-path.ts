/** Docs URLs never use a trailing slash (except `/`). */
export function stripTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '')
  }
  return pathname
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
