/**
 * Settings > Navigation workspace tree: hide/show a leaf and apply a role
 * preset. happy-dom + react-dom/client — same harness as
 * `nav-settings-button.test.tsx`.
 */

import type { ReactElement } from 'react'
import type { WorkspacePreset } from '@/lib/types/user-settings'

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

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

describe('WorkspacePresetPicker', () => {
  test('renders the sidebar tree and hides a leaf into Custom', async () => {
    const { useState } = await import('react')
    const { WorkspacePresetPicker } = await import('./workspace-preset-picker')
    const { act } = await import('react')

    function Harness() {
      const [state, setState] = useState<{
        workspacePreset: WorkspacePreset
        hiddenMenuHrefs: string[]
      }>({ workspacePreset: 'full', hiddenMenuHrefs: [] })
      return (
        <WorkspacePresetPicker
          preset={state.workspacePreset}
          hiddenMenuHrefs={state.hiddenMenuHrefs}
          onChange={setState}
        />
      )
    }

    const { container, cleanup } = await renderInto(<Harness />)

    try {
      expect(
        container.querySelector('[data-testid="workspace-menu-tree"]')
      ).toBeTruthy()
      expect(container.textContent).toContain('Overview')
      expect(container.textContent).toContain('Queries')
      expect(container.textContent).toContain('Tools')
      expect(container.textContent).toContain('Main')
      // Settings tree groups by section: Tools is last in Main, so it
      // appears after AI Agent and before the Others heading / Logs.
      const treeText =
        container.querySelector('[data-testid="workspace-menu-tree"]')
          ?.textContent ?? ''
      expect(treeText.indexOf('Tools')).toBeGreaterThan(
        treeText.indexOf('AI Agent')
      )
      expect(treeText.indexOf('Tools')).toBeLessThan(treeText.indexOf('Logs'))

      const overview = container.querySelector(
        '[data-testid="workspace-menu-leaf-/overview"]'
      )
      expect(overview).toBeTruthy()
      expect(overview?.getAttribute('data-hidden')).toBe('false')

      await act(async () => {
        overview?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      const afterHide = container.querySelector(
        '[data-testid="workspace-menu-leaf-/overview"]'
      )
      expect(afterHide?.getAttribute('data-hidden')).toBe('true')
      expect(
        container.querySelector('[role="radio"][aria-checked="true"]')
          ?.textContent
      ).toContain('Custom')

      await act(async () => {
        afterHide?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(
        container
          .querySelector('[data-testid="workspace-menu-leaf-/overview"]')
          ?.getAttribute('data-hidden')
      ).toBe('false')
    } finally {
      await cleanup()
    }
  })

  test('role pills remute the tree without a hide-pages drawer', async () => {
    const { useState } = await import('react')
    const { WorkspacePresetPicker } = await import('./workspace-preset-picker')
    const { act } = await import('react')

    function Harness() {
      const [state, setState] = useState<{
        workspacePreset: WorkspacePreset
        hiddenMenuHrefs: string[]
      }>({ workspacePreset: 'full', hiddenMenuHrefs: [] })
      return (
        <WorkspacePresetPicker
          preset={state.workspacePreset}
          hiddenMenuHrefs={state.hiddenMenuHrefs}
          onChange={setState}
        />
      )
    }

    const { container, cleanup } = await renderInto(<Harness />)

    try {
      expect(container.textContent).not.toContain('Hide pages')

      const engineer = Array.from(
        container.querySelectorAll('[role="radio"]')
      ).find((node) => node.textContent?.includes('Engineer'))
      expect(engineer).toBeTruthy()

      await act(async () => {
        engineer?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      const keeper = container.querySelector(
        '[data-testid="workspace-menu-leaf-/keeper/info"]'
      )
      expect(keeper).toBeTruthy()
      expect(keeper?.getAttribute('data-hidden')).toBe('true')

      const overview = container.querySelector(
        '[data-testid="workspace-menu-leaf-/overview"]'
      )
      expect(overview?.getAttribute('data-hidden')).toBe('false')
    } finally {
      await cleanup()
    }
  })

  test('postgres engine shows the Postgres tree, not Queries/Cluster groups', async () => {
    const { WorkspacePresetPicker } = await import('./workspace-preset-picker')

    function Harness() {
      return (
        <WorkspacePresetPicker
          preset="full"
          hiddenMenuHrefs={[]}
          engine="postgres"
          onChange={() => {}}
        />
      )
    }

    const { container, cleanup } = await renderInto(<Harness />)

    try {
      expect(
        container.querySelector('[data-testid="workspace-menu-tree"]')
      ).toBeTruthy()
      expect(
        container.querySelector(
          '[data-testid="workspace-menu-leaf-/postgres/queries"]'
        )
      ).toBeTruthy()
      expect(
        container.querySelector(
          '[data-testid="workspace-menu-leaf-/postgres/activity"]'
        )
      ).toBeTruthy()
      expect(
        container.querySelector('[data-testid="workspace-menu-leaf-/overview"]')
      ).toBeNull()
      expect(
        container.querySelector(
          '[data-testid="workspace-menu-leaf-/running-queries"]'
        )
      ).toBeNull()
      expect(
        container.querySelector('[data-testid="workspace-menu-leaf-/clusters"]')
      ).toBeNull()
      expect(
        container.querySelector('[data-testid="workspace-menu-leaf-/sql"]')
      ).toBeNull()
      expect(
        container.querySelector('[data-testid="workspace-menu-leaf-/explorer"]')
      ).toBeNull()
      expect(container.textContent).not.toContain('Cluster')
      expect(container.textContent).not.toContain('Tools')
    } finally {
      await cleanup()
    }
  })

  test('default engine still shows the Queries/Cluster tree', async () => {
    const { WorkspacePresetPicker } = await import('./workspace-preset-picker')

    function Harness() {
      return (
        <WorkspacePresetPicker
          preset="full"
          hiddenMenuHrefs={[]}
          onChange={() => {}}
        />
      )
    }

    const { container, cleanup } = await renderInto(<Harness />)

    try {
      expect(
        container.querySelector('[data-testid="workspace-menu-leaf-/overview"]')
      ).toBeTruthy()
      expect(
        container.querySelector(
          '[data-testid="workspace-menu-leaf-/running-queries"]'
        )
      ).toBeTruthy()
      expect(
        container.querySelector('[data-testid="workspace-menu-leaf-/sql"]')
      ).toBeTruthy()
      expect(
        container.querySelector(
          '[data-testid="workspace-menu-leaf-/postgres/queries"]'
        )
      ).toBeNull()
    } finally {
      await cleanup()
    }
  })
})
