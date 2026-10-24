/**
 * Query params the live registry sweep (`routes/api/v1/__tests__/registry-smoke-live.test.ts`) knows a
 * real value for. A table whose SQL needs any other param with no default
 * cannot be swept live; `registry-default-params.test.ts` catches that offline.
 */
export const SWEEP_REAL_PARAMS = ['database', 'table', 'cluster'] as const
