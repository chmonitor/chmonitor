/**
 * SettingsForm initialTab: Open Navigation lands on the Navigation pane.
 * happy-dom + react-dom/client — same harness as workspace-preset-picker.test.tsx.
 */

import type { ReactElement } from 'react'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { DEFAULT_SOURCE_ENGINE } from '@chm/types'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

mock.module('next-themes', () => ({
  useTheme: () => ({ setTheme: () => {}, theme: 'system' }),
}))

mock.module('@/lib/hooks/use-active-pg-connection', () => ({
  useActiveHostEngine: () => DEFAULT_SOURCE_ENGINE,
  useActivePgConnection: () => null,
  PG_HOST_PARAM: 'pg',
}))

mock.module('@/lib/swr/api-fetch', () => ({
  apiFetch: async () => ({ ok: false }),
}))

beforeAll(() => {
  GlobalRegistrator.register()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false
      },
    })) as typeof window.matchMedia
  }
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

afterEach(() => {
  document.body.replaceChildren()
})

async function renderInto(
  node: ReactElement
): Promise<{ container: HTMLDivElement; cleanup: () => Promise<void> }> {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(node)
  })

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      container.remove()
    },
  }
}

describe('SettingsForm initialTab', () => {
  test('defaults to General (Navigation tree is not shown)', async () => {
    const { SettingsForm } = await import('./settings-form')
    const { DEFAULT_USER_SETTINGS } = await import('@/lib/types/user-settings')

    const { container, cleanup } = await renderInto(
      <SettingsForm
        settings={DEFAULT_USER_SETTINGS}
        onUpdate={() => {}}
        onClose={() => {}}
      />
    )

    try {
      expect(
        container.querySelector('[data-testid="workspace-menu-tree"]')
      ).toBeNull()
    } finally {
      await cleanup()
    }
  })

  test('initialTab=navigation opens the Navigation pane', async () => {
    const { SettingsForm } = await import('./settings-form')
    const { DEFAULT_USER_SETTINGS } = await import('@/lib/types/user-settings')

    const { container, cleanup } = await renderInto(
      <SettingsForm
        settings={DEFAULT_USER_SETTINGS}
        onUpdate={() => {}}
        onClose={() => {}}
        initialTab="navigation"
      />
    )

    try {
      expect(
        container.querySelector('[data-testid="workspace-menu-tree"]')
      ).toBeTruthy()
    } finally {
      await cleanup()
    }
  })
})
