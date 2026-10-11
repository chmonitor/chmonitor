/**
 * Repo guard for two UI conventions (see .claude/skills/product-design):
 *
 * 1. One icon family per file: Lucide only. Mixing `@radix-ui/react-icons` and
 *    `lucide-react` gives mismatched stroke weight and sizing.
 * 2. Touch-visible controls: `opacity-0` revealed only by `group-hover` never
 *    appears on touch (no hover). Every such class string must also carry a
 *    `pointer-coarse:` / `pointer-fine:` / `focus` visibility branch.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(import.meta.dir, '..')
const COMPONENTS = join(SRC, 'components')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name) && !/\.(test|spec|cy)\./.test(name))
      out.push(full)
  }
  return out
}

const rel = (f: string) => relative(SRC, f)

/** Hover-only reveals that are purely decorative (not a control). */
const DECORATIVE_ALLOWLIST: Record<string, string> = {
  'components/cards/chart-card.tsx':
    'decorative arrow next to the title; the title link itself stays visible',
  'components/charts/chart-empty.tsx':
    'decorative glow pseudo-element on the empty-state icon, not a control',
}

/** TODO: migrate these menu definitions to Lucide only, then drop the entries. */
const MIXED_ICON_ALLOWLIST: Record<string, string> = Object.fromEntries(
  [
    'menu/queries.ts',
    'menu/settings.ts',
    'menu/postgres.ts',
    'menu/cluster-replication.ts',
    'menu/server.ts',
    'menu/data-storage.ts',
    'menu/tools.ts',
  ].map((f) => [f, 'TODO: menu section still mixes Radix and Lucide icons'])
)

describe('ui conventions', () => {
  it('no file imports from both @radix-ui/react-icons and lucide-react', () => {
    const offenders = walk(SRC).filter((f) => {
      const s = readFileSync(f, 'utf8')
      return (
        /^\} from ['"]@radix-ui\/react-icons['"]|^import .* from ['"]@radix-ui\/react-icons['"]/m.test(
          s
        ) &&
        /^\} from ['"]lucide-react['"]|^import .* from ['"]lucide-react['"]/m.test(
          s
        )
      )
    })
    const unexpected = offenders
      .map(rel)
      .filter((f) => !(f in MIXED_ICON_ALLOWLIST))
    expect(unexpected).toEqual([])
  })

  it('hover-only opacity-0 reveals also have a touch/focus branch', () => {
    const literal = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/gs
    const offenders = new Set<string>()
    for (const f of walk(COMPONENTS)) {
      if (rel(f).startsWith('components/ui/')) continue
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(literal)) {
        const cls = m[2]
        if (!/(^|[\s:])opacity-0\b/.test(cls) || !/group-hover/.test(cls))
          continue
        if (/pointer-coarse:|pointer-fine:|focus/.test(cls)) continue
        offenders.add(rel(f))
      }
    }
    const unexpected = [...offenders].filter(
      (f) => !(f in DECORATIVE_ALLOWLIST)
    )
    expect(unexpected).toEqual([])
  })
})
