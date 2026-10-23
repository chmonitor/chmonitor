import { RelatedTimeFormat } from './related-time-format'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

describe('RelatedTimeFormat', () => {
  // A NULL time (no query, never logged in) must not read as "a few seconds ago".
  test('renders nothing for a missing time', () => {
    expect(renderToStaticMarkup(<RelatedTimeFormat value={null} />)).toBe('')
    expect(renderToStaticMarkup(<RelatedTimeFormat value="" />)).toBe('')
  })

  test('renders a relative time with the raw value as title', () => {
    const html = renderToStaticMarkup(
      <RelatedTimeFormat value="2020-01-01 00:00:00" />
    )
    expect(html).toContain('title="2020-01-01 00:00:00"')
    expect(html).toContain('ago')
  })
})
