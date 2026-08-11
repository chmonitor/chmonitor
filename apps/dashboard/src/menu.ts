// The navigation tree used to be a single ~1040-line array literal here.
// It is now composed from per-section files under `menu/` (issue #2897) —
// see `menu/index.ts` for the section order and `menu/<section>.ts` for each
// top-level group. Re-exported here so every existing `@/menu` import keeps
// working unchanged.
export { menuItemsConfig } from './menu/index'
