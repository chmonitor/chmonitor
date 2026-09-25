/**
 * Two layers, deliberately:
 *
 * 1. The pure transitions (below) — no DOM, no React.
 * 2. One React mount proving the rule those transitions feed: **two consumers
 *    of `useMcpConfig` in the same tab cannot disagree.** A settings-panel
 *    toggle must invalidate the agent runtime's server list without a reload
 *    (the runtime derives the list it sends to `/api/v1/agent` in
 *    `agent-runtime-provider.tsx` the same way this test's second consumer
 *    does). With per-instance `useState` the second consumer never re-renders
 *    and this test fails — which is exactly the #3444 regression.
 *
 * happy-dom + `react-dom/client` + `act` is the one-off harness used elsewhere
 * in this repo (see `components/dashboard/time-range-context.test.tsx`).
 */

import type { McpConfigStorage, UseMcpConfigResult } from './use-mcp-config'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import {
  createCustomServer,
  MCP_CONFIG_STORAGE_KEY,
  mcpServerCounts,
  toMcpServers,
  useMcpConfig,
  withAddedServer,
  withRemovedServer,
  withServerEnabled,
} from './use-mcp-config'

beforeAll(() => {
  GlobalRegistrator.register()
  // So React's `act()` runs synchronously instead of warning (bun:test has no
  // such flag set by default, unlike Jest/Vitest's DOM presets).
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  // The store seeds from localStorage on first read, so it must start empty.
  localStorage.removeItem(MCP_CONFIG_STORAGE_KEY)
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

const base = (): McpConfigStorage => ({ disabled: [], customServers: [] })

describe('withServerEnabled', () => {
  test('disabling adds the id to the disabled list', () => {
    const next = withServerEnabled(base(), 'srv', false)
    expect(next.disabled).toEqual(['srv'])
  })

  test('disabling is idempotent (no duplicate ids)', () => {
    const once = withServerEnabled(base(), 'srv', false)
    const twice = withServerEnabled(once, 'srv', false)
    expect(twice.disabled).toEqual(['srv'])
  })

  test('enabling removes the id from the disabled list', () => {
    const disabled: McpConfigStorage = { disabled: ['srv'], customServers: [] }
    const next = withServerEnabled(disabled, 'srv', true)
    expect(next.disabled).toEqual([])
  })

  test('does not mutate the input config', () => {
    const input = base()
    withServerEnabled(input, 'srv', false)
    expect(input.disabled).toEqual([])
  })
})

describe('createCustomServer', () => {
  test('generates a unique id and preserves name/endpoint', () => {
    const a = createCustomServer({ name: 'x', endpoint: 'https://x' })
    const b = createCustomServer({ name: 'x', endpoint: 'https://x' })
    expect(a.id).toBeTruthy()
    expect(a.name).toBe('x')
    expect(a.endpoint).toBe('https://x')
    expect(a.id).not.toBe(b.id)
  })
})

describe('withAddedServer', () => {
  test('appends a server with a generated id', () => {
    const { config, created } = withAddedServer(base(), {
      name: 'remote',
      endpoint: 'https://example.com/mcp',
    })
    expect(created.id).toBeTruthy()
    expect(created.name).toBe('remote')
    expect(created.endpoint).toBe('https://example.com/mcp')
    expect(config.customServers).toEqual([created])
  })

  test('generates unique ids for successive servers', () => {
    const first = withAddedServer(base(), { name: 'a', endpoint: 'a' })
    const second = withAddedServer(first.config, { name: 'b', endpoint: 'b' })
    expect(second.created.id).not.toBe(first.created.id)
    expect(second.config.customServers).toHaveLength(2)
  })
})

describe('withRemovedServer', () => {
  test('removes the custom server and its toggle override', () => {
    const start: McpConfigStorage = {
      disabled: ['srv', 'other'],
      customServers: [
        { id: 'srv', name: 'a', endpoint: 'a' },
        { id: 'other', name: 'b', endpoint: 'b' },
      ],
    }
    const next = withRemovedServer(start, 'srv')
    expect(next.customServers.map((s) => s.id)).toEqual(['other'])
    expect(next.disabled).toEqual(['other'])
  })
})

describe('toMcpServers', () => {
  test('maps custom servers to McpServer rows with enabled state', () => {
    const servers = toMcpServers(
      [
        { id: 'on', name: 'on', endpoint: 'a' },
        { id: 'off', name: 'off', endpoint: 'b' },
      ],
      (id) => id !== 'off'
    )
    expect(servers).toEqual([
      {
        id: 'on',
        name: 'on',
        endpoint: 'a',
        toolCount: 0,
        builtin: false,
        enabled: true,
        status: 'unconfigured',
      },
      {
        id: 'off',
        name: 'off',
        endpoint: 'b',
        toolCount: 0,
        builtin: false,
        enabled: false,
        status: 'unconfigured',
      },
    ])
  })
})

describe('mcpServerCounts', () => {
  const enabled = () => true

  test('counts the built-in server even with no custom servers', () => {
    expect(mcpServerCounts([], enabled)).toEqual({ active: 1, total: 1 })
  })

  test('a disabled custom server leaves the total but not the active', () => {
    const customServers = [
      { id: 'on', name: 'on', endpoint: 'a' },
      { id: 'off', name: 'off', endpoint: 'b' },
    ]
    expect(mcpServerCounts(customServers, (id) => id !== 'off')).toEqual({
      active: 2,
      total: 3,
    })
  })
})

describe('useMcpConfig across two consumers in one tab', () => {
  test('a panel toggle reaches the runtime server list', async () => {
    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')

    let addedId = ''
    const captured: { panel: UseMcpConfigResult | null } = { panel: null }
    // What the agent runtime would send on the next request, derived exactly
    // as `agent-runtime-provider.tsx` derives its `mcpServers` memo. It is
    // assigned during render, so a stale `sent` means the runtime did not
    // re-render.
    let sent: Array<{ id: string }> = []

    function SettingsPanel() {
      captured.panel = useMcpConfig()
      return null
    }

    function AgentRuntime() {
      const { customServers, disabledServers } = useMcpConfig()
      sent = customServers
        .filter((s) => !disabledServers.includes(s.id))
        .map((s) => ({ id: s.id }))
      return null
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    act(() => {
      root.render(
        <>
          <SettingsPanel />
          <AgentRuntime />
        </>
      )
    })

    expect(sent).toEqual([])

    // 1. Registering a server in the panel must reach the runtime.
    act(() => {
      addedId =
        captured.panel?.addServer({
          name: 'grafana',
          endpoint: 'https://grafana.example/mcp',
        }).id ?? ''
    })
    expect(addedId).toBeTruthy()
    expect(sent).toEqual([{ id: addedId }])

    // 2. Toggling it off must drop it from the next request, not just grey the
    //    row out in the panel.
    act(() => {
      captured.panel?.setServerEnabled(addedId, false)
    })
    expect(sent).toEqual([])

    // 3. Toggling back on must bring it back.
    act(() => {
      captured.panel?.setServerEnabled(addedId, true)
    })
    expect(sent).toEqual([{ id: addedId }])

    // 4. Removing it must reach the runtime too.
    act(() => {
      captured.panel?.removeServer(addedId)
    })
    expect(sent).toEqual([])

    // The config still survives a reload, which is the whole point of the
    // localStorage write the store now owns.
    act(() => {
      captured.panel?.addServer({
        name: 'kept',
        endpoint: 'https://kept.example/mcp',
      })
    })
    expect(
      JSON.parse(localStorage.getItem(MCP_CONFIG_STORAGE_KEY) ?? '{}')
    ).toMatchObject({ disabled: [], customServers: [{ name: 'kept' }] })

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
