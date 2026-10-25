/**
 * `useIsMobile` must be right on the FIRST client render. It used to start
 * `undefined` and resolve in an effect, so on a phone every consumer first
 * rendered the desktop branch (the agents settings sidebar opened, then closed
 * itself and left a Drawer mounted).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// The page pulls in the whole agent runtime; only the sidebar-default hook is
// under test here.
mock.module('@/components/agents/welcome/agent-settings-sidebar', () => ({
  AgentSettingsSidebar: () => null,
}))

const { useIsMobile, useIsLgDown } = await import('./use-mobile')

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await GlobalRegistrator.unregister()
})

function stubWidth(width: number) {
  window.matchMedia = ((q: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(q)?.[1])
    return {
      matches: width <= max,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }
  }) as unknown as typeof window.matchMedia
}

async function renders<T>(hook: () => T): Promise<T[]> {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const seen: T[] = []
  const Probe = () => {
    seen.push(hook())
    return null
  }
  await React.act(async () => {
    createRoot(document.createElement('div')).render(<Probe />)
  })
  return seen
}

describe('useIsMobile', () => {
  test('is true on the first render at 360px', async () => {
    stubWidth(360)
    const seen = await renders(useIsMobile)
    expect(seen[0]).toBe(true)
    expect(seen.every(Boolean)).toBe(true)
  })

  test('is false on the first render at 1280px', async () => {
    stubWidth(1280)
    expect((await renders(useIsMobile))[0]).toBe(false)
  })

  test('tablet is not mobile but is below lg', async () => {
    stubWidth(800)
    expect((await renders(useIsMobile))[0]).toBe(false)
    expect((await renders(useIsLgDown))[0]).toBe(true)
  })
})

describe('agent settings sidebar default', () => {
  test('never renders open on a phone', async () => {
    const { useSettingsSidebarOpen } = await import(
      '@/components/assistant-ui/agent-thread-page'
    )
    stubWidth(360)
    const seen = await renders(() => {
      const isMobile = useIsMobile()
      return useSettingsSidebarOpen(isMobile)[0]
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.some((open) => open === true)).toBe(false)
  })

  test('is open on desktop', async () => {
    const { useSettingsSidebarOpen } = await import(
      '@/components/assistant-ui/agent-thread-page'
    )
    stubWidth(1280)
    const seen = await renders(() => {
      const isMobile = useIsMobile()
      return useSettingsSidebarOpen(isMobile)[0]
    })
    expect(seen.at(-1)).toBe(true)
  })
})
