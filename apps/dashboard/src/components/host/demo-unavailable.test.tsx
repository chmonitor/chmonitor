import { isDemoUnavailable } from './demo-unavailable'
import { DemoUnavailableAlert } from './demo-unavailable-banner'
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

describe('isDemoUnavailable', () => {
  const err = new Error('Failed to fetch host status: Bad Gateway')

  it('shows for a demo host whose host-status failed', () => {
    expect(isDemoUnavailable('demo', err)).toBe(true)
  })

  it('stays hidden while the demo host is healthy or still loading', () => {
    expect(isDemoUnavailable('demo', null)).toBe(false)
    expect(isDemoUnavailable('demo', undefined)).toBe(false)
  })

  it('never shows for self-hosted or user-owned hosts, even on error', () => {
    for (const source of ['env', 'browser', 'database', undefined] as const) {
      expect(isDemoUnavailable(source, err)).toBe(false)
    }
  })
})

describe('DemoUnavailableAlert', () => {
  it('renders the title and an enabled Retry button', () => {
    const html = renderToStaticMarkup(
      <DemoUnavailableAlert onRetry={() => {}} />
    )
    expect(html).toContain('Demo temporarily unavailable')
    expect(html).toContain('data-testid="demo-unavailable-retry"')
    expect(html).not.toContain('disabled=""')
  })

  it('disables Retry while a retry is in flight', () => {
    const html = renderToStaticMarkup(
      <DemoUnavailableAlert onRetry={() => {}} retrying />
    )
    expect(html).toContain('disabled=""')
  })
})
