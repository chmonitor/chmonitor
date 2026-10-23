/**
 * Server scope storage, backed by `AsyncLocalStorage`.
 *
 * Reached only through the `#attribution-storage` subpath import, whose
 * `browser` condition resolves to `storage.browser.ts` instead, so
 * `node:async_hooks` never enters the client module graph.
 */

import type { ScopeStorage } from './storage.browser'

import { AsyncLocalStorage } from 'node:async_hooks'

export type { ScopeStorage } from './storage.browser'

export function createScopeStorage<T>(): ScopeStorage<T> | null {
  return new AsyncLocalStorage<T>()
}
