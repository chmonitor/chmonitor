/**
 * CI must not send usage telemetry to the shared service. A browser cannot
 * detect CI, so the e2e and axe-core jobs (which load the real dashboard in
 * Chrome) were reporting installs from GitHub runners. DO_NOT_TRACK is the
 * opt-out that reaches both sides: vite.config.ts inlines it as
 * VITE_DO_NOT_TRACK at build time and the server reads it at runtime.
 *
 * It has to be set at workflow level so the build step and the server step both
 * see it. Do NOT set it in the release, Docker or Cloudflare workflows: it
 * would be baked into the shipped bundle and turn telemetry off for everyone.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const WORKFLOWS = resolve(import.meta.dir, '../../.github/workflows')

function workflowEnv(file: string): Record<string, unknown> | undefined {
  const parsed = Bun.YAML.parse(
    readFileSync(join(WORKFLOWS, file), 'utf8')
  ) as { env?: Record<string, unknown> }
  return parsed.env
}

describe('CI never sends telemetry', () => {
  test.each([
    ['test.yml', 'e2e-test loads the dashboard in Chrome'],
    ['a11y.yml', 'axe-core loads the dashboard in Chrome'],
    ['cli-rust-ci.yml', 'cargo test can run the real CLI'],
  ])('%s sets DO_NOT_TRACK at workflow level (%s)', (file) => {
    expect(String(workflowEnv(file)?.DO_NOT_TRACK)).toBe('1')
  })

  test.each([
    'base.yml',
    'ci.yml',
    'release.yml',
    'cloudflare.yml',
  ])('%s does not opt the shipped bundle out of telemetry', (file) => {
    expect(workflowEnv(file)?.DO_NOT_TRACK).toBeUndefined()
    expect(workflowEnv(file)?.VITE_DO_NOT_TRACK).toBeUndefined()
  })
})
