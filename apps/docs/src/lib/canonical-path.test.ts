import { isPreviewHost, stripTrailingSlash } from './canonical-path'
import { describe, expect, test } from 'bun:test'

describe('docs canonical path', () => {
  test('strips trailing slashes except root', () => {
    expect(stripTrailingSlash('/')).toBe('/')
    expect(stripTrailingSlash('/guide/')).toBe('/guide')
    expect(stripTrailingSlash('/operate/authentication/')).toBe(
      '/operate/authentication'
    )
  })

  test('preview hosts are noindexed', () => {
    expect(isPreviewHost('preview.docs.chmonitor.dev')).toBe(true)
    expect(isPreviewHost('docs.chmonitor.dev')).toBe(false)
  })
})
