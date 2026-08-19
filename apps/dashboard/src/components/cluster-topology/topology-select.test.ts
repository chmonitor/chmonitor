/**
 * WHY: a fresh `() => setSelected(null)` each TopologyView render would
 * defeat React.memo on TopoCanvas. useOnClearSelect must keep identity
 * while setSelected is stable.
 */

import { useOnClearSelect } from './topology-select'
import { describe, expect, test } from 'bun:test'
import { createElement, useState } from 'react'

describe('useOnClearSelect', () => {
  test('returns the same function across rerenders', async () => {
    if (typeof document === 'undefined') {
      const { GlobalRegistrator } = await import(
        '@happy-dom/global-registrator'
      )
      GlobalRegistrator.register()
    }

    const { act } = await import('react')
    const { createRoot } = await import('react-dom/client')

    const seen: Array<() => void> = []
    function Probe({ tick }: { tick: number }) {
      const [, setSelected] = useState<string | null>(null)
      const onClear = useOnClearSelect(setSelected)
      seen.push(onClear)
      return createElement('span', null, String(tick))
    }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(Probe, { tick: 0 }))
    })
    await act(async () => {
      root.render(createElement(Probe, { tick: 1 }))
    })

    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(seen[0]).toBe(seen[1])

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
