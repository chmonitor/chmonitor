/**
 * Browser scope storage: none. Scopes are opened by the server request
 * middleware, so client code has no scope and its queries carry no principal.
 */

export interface ScopeStorage<T> {
  run<R>(store: T, fn: () => R): R
  getStore(): T | undefined
}

export function createScopeStorage<T>(): ScopeStorage<T> | null {
  return null
}
