/**
 * WHY: the 1s "updated Ns ago" tick used to live on TopologyView, so the
 * 500-line TopoCanvas re-rendered every second. The tick belongs in
 * TopologyUpdatedAgo; onClearSelect must be useCallback so memo works.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

function src(name: string): string {
  return readFileSync(join(dir, name), 'utf8')
}

describe('topology tick isolation + stable clear-select', () => {
  test('TopologyUpdatedAgo owns the 1s interval; TopologyView does not tick', () => {
    const view = src('topology-view.tsx')
    const ago = src('topology-updated-ago.tsx')

    expect(ago).toContain('setInterval')
    expect(ago).toContain('setSecsAgo')
    expect(view).not.toContain('setInterval')
    expect(view).not.toContain('setSecsAgo')
    expect(view).toContain('TopologyUpdatedAgo')
  })

  test('onClearSelect is created with useOnClearSelect / useCallback', () => {
    const view = src('topology-view.tsx')
    const select = src('topology-select.ts')

    expect(select).toContain('useCallback')
    expect(view).toContain('useOnClearSelect')
    expect(view).toContain('onClearSelect={onClearSelect}')
    expect(view).not.toContain('onClearSelect={() => setSelected(null)}')
  })

  test('TopoCanvas is wrapped in React.memo', () => {
    const canvas = src('topo-canvas.tsx')
    expect(canvas).toMatch(/export const TopoCanvas = memo\(/)
  })
})
