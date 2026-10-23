/**
 * Test files that call `mock.module(` must restore the real module from an
 * `afterAll` / `afterEach` hook. bun patches the module registry for the whole
 * `bun test` process, so an unrestored mock makes later files fail even though
 * each passes alone (#4146 fixed 29 failures of this class, then new tests
 * brought it back).
 *
 * The allowlist is the debt that existed when this check landed. It may only
 * shrink: a listed file that now restores (or is gone) must be removed.
 * Pattern to follow: `sweep/dispatch/ack-history.test.ts`.
 */

import {
  DASHBOARD_ROOT,
  findOffenders,
  mocksWithoutRestore,
} from './mock-module-restore-scan'
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ALLOWLIST_FILE = resolve(
  import.meta.dir,
  'mock-module-restore.allowlist.txt'
)

const allowlist = readFileSync(ALLOWLIST_FILE, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))

describe('mock.module restore', () => {
  const offenders = findOffenders()

  test('no new test file mocks a module without restoring it', () => {
    const fresh = offenders.filter((file) => !allowlist.includes(file))
    expect(
      fresh,
      'These files call mock.module( with no afterAll/afterEach that calls ' +
        'mock.module( or mock.restore(. Capture the real module first, build ' +
        'the fake on it, and restore it in afterAll ' +
        '(see src/lib/health/sweep/dispatch/ack-history.test.ts).'
    ).toEqual([])
  })

  test('the allowlist only lists files that still need it', () => {
    const stale = allowlist.filter((file) => !offenders.includes(file))
    expect(
      stale,
      'Remove these from mock-module-restore.allowlist.txt: they restore ' +
        'their mocks now, or no longer exist.'
    ).toEqual([])
    for (const file of allowlist) {
      expect(existsSync(join(DASHBOARD_ROOT, file))).toBe(true)
    }
  })

  test('the detector flags a mock with no restore hook', () => {
    expect(
      mocksWithoutRestore(
        `import { mock } from 'bun:test'\nmock.module('@/x', () => ({}))\n`
      )
    ).toBe(true)
  })

  test('the detector ignores an unrelated afterAll', () => {
    expect(
      mocksWithoutRestore(
        `mock.module('@/x', () => ({}))\nafterAll(() => { cleanup() })\n`
      )
    ).toBe(true)
  })

  test('the detector ignores a mock.module( that is only in a comment', () => {
    expect(mocksWithoutRestore(`// mock.module('@/x', () => ({}))\n`)).toBe(
      false
    )
  })

  test('the detector accepts a restore in afterAll or mock.restore()', () => {
    expect(
      mocksWithoutRestore(
        `const real = { ...(await import('@/x')) }\nmock.module('@/x', () => ({ ...real, a: 1 }))\nafterAll(() => {\n  mock.module('@/x', () => ({ ...real }))\n})\n`
      )
    ).toBe(false)
    expect(
      mocksWithoutRestore(
        `mock.module('@/x', () => ({}))\nafterEach(() => mock.restore())\n`
      )
    ).toBe(false)
  })
})
