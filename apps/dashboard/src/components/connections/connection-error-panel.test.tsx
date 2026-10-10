import { ConnectionErrorPanel } from './connection-error-panel'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

describe('ConnectionErrorPanel', () => {
  // The unknown-kind copy says "the error below is the raw message", so the
  // raw message must actually be rendered for that kind.
  test('shows the raw message for an unclassified error', () => {
    const html = renderToStaticMarkup(
      <ConnectionErrorPanel message="weird upstream failure 0xDEAD" />
    )
    expect(html).toContain('weird upstream failure 0xDEAD')
    expect(html).toContain('<code>')
  })

  test('still shows the raw message for a classified error', () => {
    const html = renderToStaticMarkup(
      <ConnectionErrorPanel message="getaddrinfo ENOTFOUND ch.example.com" />
    )
    expect(html).toContain('ENOTFOUND ch.example.com')
  })
})
