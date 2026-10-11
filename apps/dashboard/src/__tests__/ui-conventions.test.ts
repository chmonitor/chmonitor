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
import { fileURLToPath } from 'node:url'

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..')
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
    expect(offenders.map(rel)).toEqual([])
  })

  it('hover-only opacity-0 reveals also have a touch/focus branch', () => {
    // `[\s\S]` instead of the `s` flag: the test tsconfig targets < ES2018.
    const literal = /(["'`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g
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
