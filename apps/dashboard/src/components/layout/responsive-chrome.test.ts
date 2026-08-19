/**
 * Layout contracts for the mobile/tablet QA pass: sidebar overlay below lg,
 * opaque mobile drawer, scrolling overview tabs, 44px phone chrome.
 *
 * Reads the source of the wired components so a className regression fails
 * here instead of only on a phone screenshot.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = resolve(here, '../..')

function src(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

describe('responsive chrome', () => {
  test('app sidebar overlays below lg instead of docking at md', () => {
    const sidebar = src('components/ui/sidebar.tsx')
    expect(sidebar).toContain('useIsLgDown')
    expect(sidebar).toContain('lg:block')
    expect(sidebar).toContain('lg:flex')
    expect(sidebar).not.toMatch(/hidden text-sidebar-foreground md:block/)
    expect(src('components/resizable-sidebar-provider.tsx')).toContain(
      'lg:flex'
    )
  })

  test('mobile sidebar drawer is opaque and drops the frost overlay', () => {
    const sidebar = src('components/ui/sidebar.tsx')
    expect(sidebar).toContain('isolate')
    expect(sidebar).toContain('backdrop-blur-none')
    expect(sidebar).toContain('bg-sidebar')

    const css = src('styles.css')
    expect(css).toContain("[data-slot='sidebar'][data-mobile='true']")
    expect(css).toContain('backdrop-filter: none')
    expect(css).toContain('oklch(0 0 0 / 0.55)')
  })

  test('overview tabs scroll instead of clipping Memory', () => {
    const overview = src('routes/(dashboard)/overview.tsx')
    expect(overview).toContain('scrollbar-hide overflow-x-auto')
    expect(overview).toContain('w-max min-w-full')
    expect(overview).toContain('shrink-0 whitespace-nowrap')
  })

  test('phone chrome uses a 44px tap target', () => {
    expect(src('components/layout/dashboard-shell.tsx')).toContain(
      'size-11 lg:size-7'
    )
    expect(src('components/header/time-range-picker.tsx')).toContain(
      'min-h-11 min-w-11'
    )
    expect(src('components/navigation/nav-main/menu-item.tsx')).toContain(
      'h-11 min-h-11'
    )
    expect(src('components/layout/dashboard-shell.tsx')).toContain('pb-16')
    expect(src('components/compare/add-another-host-button.tsx')).toContain(
      'min-h-11'
    )
  })

  test('header utility icons are 44px below lg', () => {
    const tap = 'min-h-11 min-w-11'
    const desktop = 'lg:min-h-8 lg:min-w-8'
    expect(src('components/header/refresh-countdown.tsx')).toContain(tap)
    expect(src('components/header/refresh-countdown.tsx')).toContain(desktop)
    expect(src('components/header/header-actions.tsx')).toContain(tap)
    expect(src('components/header/header-actions.tsx')).toContain(desktop)
    expect(
      src('components/controls/command-palette/command-palette-items.tsx')
    ).toContain(tap)
    expect(
      src('components/controls/command-palette/command-palette-items.tsx')
    ).toContain(desktop)
    expect(src('components/header/time-range-picker.tsx')).toContain(
      'sm:min-h-0 sm:min-w-0'
    )
    expect(src('components/layout/dashboard-shell.tsx')).toContain(
      'size-11 lg:size-7'
    )
  })

  test('heatmap last stat card clears the FAB on small screens', () => {
    const heatmap = src('components/charts/query/query-count-heatmap.tsx')
    expect(heatmap).toContain('max-lg:col-span-2 max-lg:pr-16')
  })

  test('overview KPI cards wrap at sm+ and only truncate on phones', () => {
    const kpi = src('components/overview-charts/kpi-card.tsx')
    expect(kpi).toContain('max-sm:truncate')
    expect(kpi).toContain('sm:whitespace-normal')
    expect(kpi).not.toMatch(/className=\{cn\(VALUE_CLASS, 'truncate/)
    expect(kpi).not.toMatch(
      /<span className="truncate text-\[10\.5px\] font-semibold uppercase/
    )
  })

  test('sidebar content scrolls last groups above the footer', () => {
    const sidebar = src('components/ui/sidebar.tsx')
    // Content pane stays the scroll container (44px phone rows overflow svh).
    expect(sidebar).toContain('data-sidebar="content"')
    expect(sidebar).toContain(
      'overflow-auto overscroll-contain group-data-[collapsible=icon]:overflow-hidden'
    )
    expect(sidebar).toContain('min-h-0 flex-1')
    // Header/footer do not shrink over Queries/Cluster.
    expect(sidebar).toContain('data-sidebar="footer"')
    expect(sidebar).toContain('data-sidebar="header"')
    expect(sidebar).toContain('flex shrink-0 flex-col gap-2 p-2')
    // Inner column clips so the About footer cannot paint over the list.
    expect(sidebar).toContain(
      'flex size-full flex-col overflow-hidden bg-sidebar'
    )
  })
})
