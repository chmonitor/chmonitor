/**
 * Relative markdown links must resolve.
 *
 * AGENTS.md treats itself, the SKILL.md files under .claude/skills, and the
 * notes under docs/knowledge as a contract: an agent loads one cold, mid-task,
 * and follows the paths it names. A link to a file that moved is not a
 * cosmetic defect — it sends the reader to a dead end and costs a whole
 * re-derivation.
 *
 * This is a gate, not a report. The desk's `local:docs` job covers what a
 * deterministic check cannot reach (paths named in prose, dangling
 * `related:` ids, stale `updated:` dates); this covers the machine-checkable
 * class, and it fails the PR that introduces the rot.
 *
 * Scope notes, both deliberate:
 *   - .claude/skills/pstack/upstream is a PINNED vendored copy of an external
 *     release, tracked with a content-manifest hash. Its internal links are
 *     relative to the upstream repo root, not the vendored path, so they cannot
 *     resolve here and "fixing" them would break the pin.
 *   - Symlinked entries under .claude/skills point at .agents/skills (end-user
 *     agent skills, not ours). Skipped for the same reason: their relative
 *     links resolve against the real path, not the symlink.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../..')

/** Directories whose markdown is repo-owned and therefore gated. */
const SCAN_ROOTS = [
  '.claude/skills',
  'docs/knowledge',
  'docs/herdr-desk',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
]

/** Pinned external copy: internal links are relative to the upstream root. */
const EXCLUDED = ['.claude/skills/pstack/upstream']

/**
 * Fenced blocks and inline code spans are not prose links — a shell snippet or
 * a `path/in/backticks` mention must not be treated as a broken link. Strip
 * them before extracting, or every documented command turns into a failure.
 */
function stripNonProse(source: string): string {
  return source.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
}

/** Collect markdown files under a root, skipping symlinks and excluded trees. */
function collect(target: string, found: string[] = []): string[] {
  const abs = resolve(ROOT, target)
  let stats
  try {
    stats = lstatSync(abs)
  } catch {
    return found
  }
  // A symlinked entry resolves its own relative links against the real path,
  // so a check rooted at the symlink would report false failures.
  if (stats.isSymbolicLink()) return found
  if (EXCLUDED.some((e) => abs === resolve(ROOT, e))) return found
  if (stats.isDirectory()) {
    for (const entry of readdirSync(abs).sort()) {
      collect(join(target, entry), found)
    }
  } else if (target.endsWith('.md')) {
    found.push(target)
  }
  return found
}

/** Relative markdown link targets, with anchors and query strings removed. */
function relativeTargets(source: string): string[] {
  const targets: string[] = []
  for (const match of stripNonProse(source).matchAll(/\]\(([^)\s]+)/g)) {
    const raw = match[1]
    // Skip absolute URLs, mailto, same-page anchors, and site-rooted paths —
    // none of them are repo-relative and none can be resolved from disk.
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(raw)) continue
    const clean = raw.split('#')[0].split('?')[0]
    if (clean) targets.push(clean)
  }
  return targets
}

const files = SCAN_ROOTS.flatMap((r) => collect(r))

describe('relative markdown links resolve', () => {
  test('the scan actually covers the contract', () => {
    // A glob that silently matches nothing would make every other assertion
    // below vacuously true. Pin the floor.
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('AGENTS.md')
    expect(files).toContain('docs/knowledge/issue-desk.md')
  })

  test('the pinned upstream copy is excluded', () => {
    expect(files.some((f) => f.includes('pstack/upstream'))).toBe(false)
  })

  test('every relative link in every scanned file resolves', () => {
    const broken: string[] = []
    let checked = 0
    for (const file of files) {
      const source = readFileSync(resolve(ROOT, file), 'utf8')
      for (const target of relativeTargets(source)) {
        checked++
        if (!existsSync(resolve(ROOT, dirname(file), target))) {
          broken.push(`${file} -> ${target}`)
        }
      }
    }
    // Guard the same way: an empty scan proves nothing.
    expect(checked).toBeGreaterThan(100)
    expect(broken).toEqual([])
  })
})
