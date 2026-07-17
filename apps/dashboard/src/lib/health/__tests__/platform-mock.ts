/**
 * Shared `@chm/platform` module mock for the `lib/health` test suites.
 *
 * Why this exists (issue #2672): bun's `mock.module` patches the module
 * registry for the WHOLE test process, and a module under test that was
 * loaded while an EARLIER file's `mock.module('@chm/platform', ...)` was
 * active stays bound to that earlier mock's suite-local fake D1 — later
 * re-mocks of the same package specifier do not rebind it. So running the
 * directory in a single `bun test src/lib/health/` process failed suites
 * that pass in isolation (`pnpm run test` is unaffected because it passes
 * `--isolate`, which runs each file in its own process).
 *
 * The fix: every suite installs the SAME mock factory, whose
 * `getD1Database` calls a mutable provider at call time. The suite that is
 * currently running registers its own provider, so it never matters which
 * file loaded the module under test first — the mock always resolves to the
 * running suite's fake D1.
 *
 * Usage (at the top of a test file, before importing the module under test):
 *
 *   let fakeDb: FakeD1 | null = null
 *   installHealthPlatformMock(() => fakeDb)
 *   const { thing } = await import('./thing-under-test')
 *
 * Reassignments of the suite-local variable are picked up automatically
 * because the provider is evaluated lazily on every `getD1Database` call.
 */

import { mock } from 'bun:test'

type D1Provider = () => unknown

let currentProvider: D1Provider = () => undefined

/**
 * Install (or re-point) the shared `@chm/platform` mock so that
 * `getPlatformBindings().getD1Database(...)` resolves through `provider`.
 */
export function installHealthPlatformMock(provider?: D1Provider): void {
  if (provider) currentProvider = provider
  mock.module('@chm/platform', () => ({
    getPlatformBindings: () => ({
      getD1Database: () => currentProvider(),
    }),
  }))
}
