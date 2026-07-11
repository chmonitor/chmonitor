/**
 * Regression guard for the "Sign Out does nothing" incident.
 *
 * PR #2361 migrated `components/ui/dropdown-menu.tsx` from Radix UI to Base
 * UI (`@base-ui/react/menu`). Radix's `DropdownMenu.Item` fires `onSelect`;
 * Base UI's `Menu.Item` (and the Checkbox/Radio/SubTrigger variants) has no
 * `onSelect` prop and the wrapper passes props straight through with no
 * mapping — React silently drops the unknown prop, so `onSelect={...}`
 * became a dead click across the app (Sign Out, Settings, Add Widget menu,
 * …). The fix is `onClick` (Base UI's real click handler); a checkbox/radio
 * item that used `onSelect={(e) => e.preventDefault()}` just to keep the
 * menu open should instead rely on Base UI's default `closeOnClick={false}`
 * for those variants, or use `closeOnClick={false}` explicitly on a plain
 * item.
 *
 * This test scans the app source for `<DropdownMenu*Item`/`SubTrigger` tags
 * that still carry `onSelect=` so this class of bug can't silently return.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// `src/` — three levels above this `__tests__` folder (lib/__tests__ -> lib -> src).
const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url))

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === '__tests__' || entry === 'ui') continue
      out.push(...walk(full))
    } else if (
      (entry.endsWith('.tsx') || entry.endsWith('.ts')) &&
      !entry.includes('.test.') &&
      !entry.includes('.spec.')
    ) {
      out.push(full)
    }
  }
  return out
}

// Matches an opening `<DropdownMenuItem`, `<DropdownMenuCheckboxItem`,
// `<DropdownMenuRadioItem`, or `<DropdownMenuSubTrigger` tag that contains an
// `onSelect=` prop before its closing `>`. `[^>]` also matches newlines (only
// `.` excludes them in JS regex), so this spans multi-line JSX props.
const MENU_ITEM_ONSELECT =
  /<DropdownMenu(?:Item|CheckboxItem|RadioItem|SubTrigger)\b[^>]*\bonSelect=/

describe('no onSelect on Base UI dropdown menu items', () => {
  const files = walk(SRC_ROOT)

  test('discovers a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  test('no DropdownMenu*Item/SubTrigger uses onSelect (Base UI has no such prop; use onClick)', () => {
    const offenders = files.filter((f) =>
      MENU_ITEM_ONSELECT.test(readFileSync(f, 'utf8'))
    )
    if (offenders.length > 0) {
      const rel = offenders.map((f) => f.slice(SRC_ROOT.length))
      throw new Error(
        'Found <DropdownMenuItem>/<DropdownMenuCheckboxItem>/' +
          '<DropdownMenuRadioItem>/<DropdownMenuSubTrigger> with an onSelect ' +
          'prop. Base UI menu items (components/ui/dropdown-menu.tsx, backed ' +
          'by @base-ui/react/menu) have no onSelect prop — React silently ' +
          'drops it and the handler never runs (see the "Sign Out does ' +
          'nothing" incident). Use onClick instead; if onSelect was only ' +
          'used to keep the menu open, note that Base UI already defaults ' +
          'closeOnClick to false for CheckboxItem/RadioItem, or set ' +
          `closeOnClick={false} explicitly on a plain Item:\n  ${rel.join('\n  ')}`
      )
    }
    expect(offenders).toHaveLength(0)
  })
})
