/**
 * The agent skills registry (apps/dashboard/src/lib/ai/agent/skills/registry.ts)
 * is generated from .agents/skills/<name>/SKILL.md by
 * scripts/build-skills-registry.ts and committed. This test regenerates it in
 * memory and fails when the committed copy differs, so `pnpm run build:skills`
 * on a clean tree never rewrites unrelated lines (#4079).
 */

import {
  generateSkillsRegistry,
  REGISTRY_RELATIVE_PATH,
} from '../../scripts/build-skills-registry'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

describe('agent skills registry', () => {
  test('committed registry.ts equals the generator output', async () => {
    const committed = readFileSync(
      join(REPO_ROOT, REGISTRY_RELATIVE_PATH),
      'utf8'
    )
    const { output, count } = await generateSkillsRegistry(REPO_ROOT)

    expect(count).toBeGreaterThan(0)
    // Boolean compare so a failure prints a short message, not 4k lines.
    expect(
      output === committed,
      'registry.ts is stale or hand-edited: run `pnpm run build:skills`'
    ).toBe(true)
  })
})
