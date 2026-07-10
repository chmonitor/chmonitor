# Plan 79: Preserve menu-link query params + add a menu invariant test

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/components/menu/link-with-context.tsx apps/dashboard/src/menu.ts`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2496

## Why this matters

`HostPrefixedLink` strips the query string from menu hrefs and replaces it with
only `{ host }`. Two menu entries carry meaningful query params, so their
deep-link intent is dead:

- `apps/dashboard/src/menu.ts:591` — `href: '/keeper?path=/'` (loses `path`)
- `apps/dashboard/src/menu.ts:946` — `href: '/charts?name=connections-http,connections-interserver'`
  (loses `name`; `routes/(dashboard)/charts.tsx` reads `?name=` (~line 65) to
  pick charts — without it users get the generic quick-picks grid instead)

Bundled here: a cheap invariant test for `menu.ts` (1014 lines of declarative
config, highest-churn file in the app, no direct test).

## Current state

`apps/dashboard/src/components/menu/link-with-context.tsx` (~lines 70-84):
the component computes `const toPath = href.split('?')[0]` and
`const searchParams = { host: hostId }` (read the file for exact lines), then:

```tsx
<Link
  to={toPath as any}
  search={searchParams as any}
```

Menu logic that IS tested: `src/lib/menu/__tests__/visible-items.test.ts`,
`breadcrumb.test.ts` — use as structural patterns for the new test.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Tests | `cd apps/dashboard && bun test src/components/menu src/lib/menu` | all pass |
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |

## Scope

**In scope**: `link-with-context.tsx` (merge href query params),
new `src/lib/menu/__tests__/menu-config-invariants.test.ts`.

**Out of scope**: `menu.ts` content changes; prefetch behaviour in the same
file (plan 72 touches `prefetchRoute` inputs — no conflict, different lines).

## Git workflow

- Branch: `advisor/79-menu-link-search-params`
- Commit: `fix(menu): preserve href query params in host-prefixed links`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Merge params in `HostPrefixedLink`
Parse `href.split('?')[1]` with `URLSearchParams`, spread its entries into the
`search` object first, then set `host: hostId` last (host must win on
collision).
**Verify**: `pnpm run build` exit 0.

### Step 2: Component-level unit test
Test the pure param-merging (extract a small helper `mergeHrefSearch(href, hostId)`
if that makes it testable without rendering): `/charts?name=a,b` + host 2 →
`{ name: 'a,b', host: 2 }`; `/merges` + host 0 → `{ host: 0 }`;
`/x?host=9` + host 1 → `{ host: 1 }`.
**Verify**: `bun test src/components/menu` (or the helper's test path) → pass.

### Step 3: Menu invariant test
`menu-config-invariants.test.ts` over `menuItemsConfig` from `src/menu.ts`:
- unique ids and hrefs across all items (flatten nested children)
- every href path (before `?`) matches an existing route file under
  `src/routes/(dashboard)/` (mirror how breadcrumb/visible-items tests import
  the config; a static list of known route paths derived from the route tree is
  acceptable — see `routeTree.gen.ts` for the generated route ids)
**Verify**: `bun test src/lib/menu` → all pass.

## Done criteria

- [ ] Clicking-path logic preserves `?name=`/`?path=` (unit-tested)
- [ ] Menu invariant test exists and passes
- [ ] Build + tests green; `plans/README.md` updated

## STOP conditions

- TanStack Router's typed `search` rejects extra params on some routes at the
  type level in a way `as any` no longer bypasses — report rather than loosening
  route validation.
- `routeTree.gen.ts` route-id shapes don't map cleanly to menu hrefs — do the
  invariant test with ids/hrefs uniqueness only and note the route-existence
  check as deferred.

## Maintenance notes

- New menu entries with query params now Just Work; the invariant test guards
  dangling hrefs on the highest-churn file in the app.
