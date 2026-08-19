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

function selectedPreset(container: HTMLElement): string {
  return (
    container.querySelector('[role="radio"][aria-checked="true"]')
      ?.textContent ?? ''
  )
}

async function clickPreset(container: HTMLElement, label: string) {
  const { act } = await import('react')
  const option = Array.from(container.querySelectorAll('[role="radio"]')).find(
    (node) => node.textContent?.includes(label)
  )
  expect(option).toBeTruthy()
  await act(async () => {
    option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function expandGroup(container: HTMLElement, title: string) {
  const { act } = await import('react')
  const trigger = container.querySelector(
    `[data-testid="workspace-menu-group-${title}"]`
  )
  expect(trigger).toBeTruthy()
  if (trigger?.getAttribute('aria-expanded') === 'true') return
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
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

      const keeperGroup = container.querySelector(
        '[data-testid="workspace-menu-group-Keeper"]'
      )
      expect(keeperGroup).toBeTruthy()
      await expandGroup(container, 'Keeper')

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
      await expandGroup(container, 'Queries')
      expect(
        container.querySelector(
          '[data-testid="workspace-menu-leaf-/running-queries"]'
        )
      ).toBeTruthy()
      await expandGroup(container, 'Tools')
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

  test('submenu rows are left-aligned with Hide on the right', async () => {
    const { WorkspacePresetPicker } = await import('./workspace-preset-picker')

    const { container, cleanup } = await renderInto(
      <WorkspacePresetPicker
        preset="full"
        hiddenMenuHrefs={[]}
        onChange={() => {}}
      />
    )

    try {
      await expandGroup(container, 'AI Agent')
      const chat = container.querySelector(
        '[data-testid="workspace-menu-leaf-/agents"]'
      )
      expect(chat).toBeTruthy()
      expect(chat?.className).toMatch(/\btext-left\b/)
      expect(chat?.className).toMatch(/\bitems-center\b/)
      expect(chat?.textContent).toContain('Chat')
      expect(chat?.textContent).toMatch(/Hide$/)
    } finally {
      await cleanup()
    }
  })

  test('role pills remount groups collapsed', async () => {
    const { useState } = await import('react')
    const { WorkspacePresetPicker } = await import('./workspace-preset-picker')

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
      const queries = () =>
        container.querySelector('[data-testid="workspace-menu-group-Queries"]')
      expect(queries()?.getAttribute('aria-expanded')).toBe('false')

      await expandGroup(container, 'Queries')
      expect(queries()?.getAttribute('aria-expanded')).toBe('true')

      await clickPreset(container, 'Engineer')
      expect(selectedPreset(container)).toContain('Engineer')
      expect(queries()?.getAttribute('aria-expanded')).toBe('false')

      await clickPreset(container, 'Full')
      expect(queries()?.getAttribute('aria-expanded')).toBe('false')
    } finally {
      await cleanup()
    }
  })

  test('expanding a group does not switch the preset to Custom', async () => {
    const { useState } = await import('react')
    const { WorkspacePresetPicker } = await import('./workspace-preset-picker')

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
      expect(selectedPreset(container)).toContain('Full')
      await expandGroup(container, 'Queries')
      expect(selectedPreset(container)).toContain('Full')
      expect(selectedPreset(container)).not.toContain('Custom')

      const queries = container.querySelector(
        '[data-testid="workspace-menu-group-Queries"]'
      )
      const { act } = await import('react')
      await act(async () => {
        queries?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(queries?.getAttribute('aria-expanded')).toBe('false')
      expect(selectedPreset(container)).toContain('Full')
    } finally {
      await cleanup()
    }
  })

  test('hiding a leaf still switches the preset to Custom', async () => {
    const { useState } = await import('react')
    const { WorkspacePresetPicker } = await import('./workspace-preset-picker')

    function Harness() {
      const [state, setState] = useState<{
        workspacePreset: WorkspacePreset
        hiddenMenuHrefs: string[]
      }>({ workspacePreset: 'engineer', hiddenMenuHrefs: [] })
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
      expect(selectedPreset(container)).toContain('Engineer')
      await expandGroup(container, 'Queries')
      expect(selectedPreset(container)).toContain('Engineer')

      const running = container.querySelector(
        '[data-testid="workspace-menu-leaf-/running-queries"]'
      )
      expect(running).toBeTruthy()
      const { act } = await import('react')
      await act(async () => {
        running?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(selectedPreset(container)).toContain('Custom')
    } finally {
      await cleanup()
    }
  })
})
