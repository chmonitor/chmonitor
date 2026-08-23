import {
  docsCanonicalRedirect,
  isPreviewHost,
  stripTrailingSlash,
} from './canonical-path'
import { describe, expect, test } from 'bun:test'

describe('docs canonical path', () => {
  test('strips trailing slashes except root', () => {
    expect(stripTrailingSlash('/')).toBe('/')
    expect(stripTrailingSlash('/guide/')).toBe('/guide')
    expect(stripTrailingSlash('/operate/authentication/')).toBe(
      '/operate/authentication'
    )
  })

  test('legacy IA + slash is a single hop to the new path', () => {
    expect(docsCanonicalRedirect('/deploy/k8s')).toBe('/operate/deploy/k8s')
    expect(docsCanonicalRedirect('/deploy/k8s/')).toBe('/operate/deploy/k8s')
    expect(docsCanonicalRedirect('/features/operations')).toBe(
      '/guide/features/operations'
    )
    expect(docsCanonicalRedirect('/features/operations/')).toBe(
      '/guide/features/operations'
    )
    expect(docsCanonicalRedirect('/advanced/peerdb-monitoring')).toBe(
      '/operate/advanced/peerdb-monitoring'
    )
    expect(docsCanonicalRedirect('/guide/')).toBe('/guide')
    expect(docsCanonicalRedirect('/guide/features/operations')).toBeNull()
  })

  test('preview hosts are noindexed', () => {
    expect(isPreviewHost('preview.docs.chmonitor.dev')).toBe(true)
    expect(isPreviewHost('docs.chmonitor.dev')).toBe(false)
  })
})
