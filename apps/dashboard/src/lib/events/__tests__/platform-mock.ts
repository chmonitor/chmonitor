/**
 * Shared `@chm/platform` module mock for the `lib/events` test suites
 * (issue #2777 — same root cause as `lib/health`'s `__tests__/platform-mock.ts`,
 * see #2672).
 *
 * bun's `mock.module` patches the module registry for the WHOLE test process.
 * Each of `event-store.test.ts`, `queue-consumer.test.ts`,
 * `outbound-bus.test.ts`, and `subscription-store.sql.test.ts` used to call
 * `mock.module('@chm/platform', ...)` with its own factory closing over its
 * own suite-local fake D1 variable. Whichever file's factory happened to be
 * registered LAST (an execution-order accident, not something any one file
 * controls) is the one that actually backs every subsequent `import
 * '@chm/platform'` for the rest of the process — including modules other
 * suites import — so `pnpm run test:unit` (no `--isolate`) was flaky
 * depending on file order.
 *
 * The fix: every suite installs the SAME mock factory, whose
 * `getD1Database` calls a mutable provider at call time. The suite that is
 * currently running registers its own provider, so it never matters which
 * file loaded `@chm/platform` first — the mock always resolves to the
 * running suite's fake D1.
 *
 * Usage (at the top of a test file, before importing the module under test):
 *
 *   let fakeDb: FakeD1 | null = null
 *   installEventsPlatformMock(() => fakeDb)
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
export function installEventsPlatformMock(provider?: D1Provider): void {
  if (provider) currentProvider = provider
  mock.module('@chm/platform', () => ({
    getPlatformBindings: () => ({
      getD1Database: () => currentProvider(),
      getQueue: () => null,
      getDurableObjectNamespace: () => null,
    }),
  }))
}
