import { isDemoUnavailable } from './demo-unavailable'
import { DemoUnavailableAlert } from './demo-unavailable-banner'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
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
      <DemoUnavailableAlert onRetry={() => {}} onDismiss={() => {}} />
    )
    expect(html).toContain('Demo temporarily unavailable')
    expect(html).toContain('data-testid="demo-unavailable-retry"')
    expect(html).not.toContain('disabled=""')
  })

  it('disables Retry while a retry is in flight', () => {
    const html = renderToStaticMarkup(
      <DemoUnavailableAlert onRetry={() => {}} onDismiss={() => {}} retrying />
    )
    expect(html).toContain('disabled=""')
  })

  it('is a fixed overlay, never in flow, so it cannot shift page content', () => {
    const html = renderToStaticMarkup(
      <DemoUnavailableAlert onRetry={() => {}} onDismiss={() => {}} />
    )
    const tag = html.match(/<div[^>]*demo-unavailable-banner[^>]*>/)?.[0] ?? ''
    const classes = (tag.match(/class="([^"]*)"/)?.[1] ?? '').split(' ')
    expect(classes).toContain('fixed')
    expect(classes).not.toContain('mb-4')
    expect(tag).toContain('role="alert"')
  })

  it('keeps a 44px Retry target on touch', () => {
    const html = renderToStaticMarkup(
      <DemoUnavailableAlert onRetry={() => {}} onDismiss={() => {}} />
    )
    expect(html).toContain('pointer-coarse:h-11')
  })

  it('offers a 44px Dismiss button on touch so the overlay never traps page controls', () => {
    const html = renderToStaticMarkup(
      <DemoUnavailableAlert onRetry={() => {}} onDismiss={() => {}} />
    )
    const tag =
      html.match(/<button[^>]*demo-unavailable-dismiss[^>]*>/)?.[0] ?? ''
    expect(tag).toContain('aria-label="Dismiss"')
    expect(tag).toContain('pointer-coarse:size-11')
  })

  describe('in the browser', () => {
    beforeAll(() => {
      GlobalRegistrator.register()
      ;(
        globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
      ).IS_REACT_ACT_ENVIRONMENT = true
    })
    afterAll(async () => {
      await GlobalRegistrator.unregister()
    })

    it('calls onDismiss when Dismiss is clicked', async () => {
      const { act } = await import('react')
      const { createRoot } = await import('react-dom/client')
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      let dismissed = 0
      await act(async () => {
        root.render(
          <DemoUnavailableAlert
            onRetry={() => {}}
            onDismiss={() => {
              dismissed++
            }}
          />
        )
      })
      const button = container.querySelector<HTMLButtonElement>(
        '[data-testid="demo-unavailable-dismiss"]'
      )
      await act(async () => {
        button?.click()
      })
      expect(dismissed).toBe(1)
      await act(async () => root.unmount())
      container.remove()
    })
  })
})
