import { ColumnHeader } from './column-header'
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ColumnFormat } from '@/types/column-format'

// Sort and info buttons are under 24px; on coarse pointers they grow a 44px
// hit area through an ::after overlay, without changing layout.
const HIT_AREA = [
  'relative',
  'pointer-coarse:after:absolute',
  'pointer-coarse:after:-inset-y-3',
]

function buttonTokens(html: string, label: string) {
  const tag = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html)
  expect(tag).not.toBeNull()
  const cls = /class="([^"]*)"/.exec(tag?.[0] ?? '')
  return (cls?.[1] ?? '').split(/\s+/)
}

describe('ColumnHeader touch hit areas', () => {
  const column = {
    getIsSorted: () => false,
    getCanSort: () => true,
    toggleSorting: () => {},
  } as never

  const html = renderToStaticMarkup(
    <ColumnHeader
      column={column}
      name="Rows"
      format={ColumnFormat.Number}
      description="Row count"
      isFilterable={false}
      filterValue=""
      onFilterChange={() => {}}
    />
  )

  it('gives the sort button a vertical-only 44px touch area', () => {
    const tokens = buttonTokens(html, 'Sort by Rows')
    for (const t of HIT_AREA) expect(tokens).toContain(t)
  })

  it('gives the info button a vertical-only 44px touch area', () => {
    const tokens = buttonTokens(html, 'About Rows column')
    for (const t of HIT_AREA) expect(tokens).toContain(t)
  })
})
