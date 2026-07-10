# Plan 94: Toolchain hygiene — depcruise excludes, TS/React version alignment, dead design-system dir

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- package.json apps/bug-handler/package.json apps/dashboard/package.json apps/docs/package.json apps/landing/package.json design-system .deepsec/package.json`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW–MED (TS major bump in one small app)
- **Depends on**: none
- **Category**: dx / tech-debt
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2511

## Why this matters

Five small hygiene issues that each mislead contributors or break guardrails:

1. **`pnpm run depcruise` is unusable after any build**: its `--exclude` regex
   still lists Next.js-era dirs (`\.next`, `\.open-next`) but not `.output`
   (the TanStack Start build dir), so it cruises minified bundles → ~1533 false
   violations, exit 253. The dependency-boundary guard is effectively dead.
2. **TypeScript major drift**: `apps/bug-handler` on `^5.7.0`; everything else
   on `^6` — shared `@chm/types` validated under a different compiler than what
   ships bug-handler. Dashboard's bare `"^6"` also lacks a minor floor.
3. **React minor drift**: dashboard `^19`, docs `^19.1.0`, landing `^19.2.7`.
4. **`design-system/` is committed but dead**: `tokens.css`,
   `docs-tokens.css`, `tokens.json` — zero references repo-wide.
5. **`.deepsec/` pins `pnpm@11.2.2`** vs the repo's `pnpm@10.18.0` — corepack
   silently switches pnpm majors when working in that dir.

## Current state

- `package.json:46` (repo root):
  `"depcruise": "depcruise apps packages --config .dependency-cruiser.cjs --exclude 'node_modules|\\.next|\\.open-next|dist|\\.turbo|__tests__|\\.test\\.|\\.spec\\.|\\.cy\\.'"`
- `apps/bug-handler/package.json:19` → `"typescript": "^5.7.0"`;
  `apps/dashboard/package.json:159` → `"typescript": "^6"`;
  root + docs → `^6.0.0`.
- `apps/dashboard/package.json:123` → `"react": "^19"`;
  `apps/docs/package.json:29` → `^19.1.0`; `apps/landing/package.json:25` → `^19.2.7`.
- `design-system/` — three tracked files, no references (verify again in Step 4).
- `.deepsec/package.json` → `"packageManager": "pnpm@11.2.2"`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Depcruise | `pnpm run depcruise` (repo root, AFTER a dashboard build exists) | exit 0, ~0 violations from `.output` |
| Bug-handler check | `cd apps/bug-handler && pnpm install && pnpm run build` (read its scripts) | exit 0 |
| Dashboard build | `cd apps/dashboard && pnpm install && pnpm run build` | exit 0 |

## Scope

**In scope**: root `package.json` depcruise script (+ mirror in
`.dependency-cruiser.cjs` if it has its own excludes), the four app
package.json version fields + their lockfiles (`pnpm install` per isolated
workspace), `design-system/` removal, `.deepsec/package.json` pnpm pin.

**Out of scope**: `@opennextjs/cloudflare` (plan 96); dependency upgrades
beyond the floors named; `.deepsec` internals.

## Git workflow

- Branch: `advisor/94-toolchain-version-alignment`
- Commits: one per numbered item, semantic (`chore(dx): …`, `chore(deps): …`)
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Fix depcruise excludes
Add `\\.output|\\.vercel` to the exclude regex; drop `\\.next|\\.open-next`.
Mirror in `.dependency-cruiser.cjs` if it declares its own `exclude`.
**Verify**: run a dashboard build, then `pnpm run depcruise` → exit 0 (or only
genuine source violations — if any REAL source cycle surfaces once the noise is
gone, list it in the PR description as a follow-up finding; do not fix it here).

### Step 2: TypeScript alignment
`apps/bug-handler` → `"typescript": "^6.0.0"`; `apps/dashboard` → `"^6.0.0"`.
Reinstall each isolated workspace; run their builds. Fix any new TS6 errors in
bug-handler only if trivial (type annotations); else STOP condition.
**Verify**: both apps build exit 0.

### Step 3: React floor alignment
Set `"react"`/`"react-dom"` to `^19.2.7`-compatible floors in dashboard and
docs (match landing). Reinstall + build each.
**Verify**: builds green; `rg -n '"react": "' apps/*/package.json` shows one floor.

### Step 4: Remove design-system/
Re-verify zero references: `rg -rn "design-system/" apps packages scripts docs .github --glob '!*.lock*' | rg -v Binary` → nothing. Then `git rm -r design-system/`.
**Verify**: full repo builds unaffected (dashboard build green).

### Step 5: Align .deepsec pnpm
Set `.deepsec/package.json` `packageManager` to `pnpm@10.18.0`, OR — if its
lockfile is pnpm-11-format — add a one-line note to `.deepsec/AGENTS.md` that
it intentionally runs its own pnpm. Prefer the note if reinstalling `.deepsec`
is disruptive.
**Verify**: whichever path — file changed accordingly.

## Done criteria

- [ ] `pnpm run depcruise` exits 0 post-build
- [ ] One TS floor (`^6.0.0`) and one React floor across apps; all builds green
- [ ] `design-system/` gone (or wired + documented if a reference was found — then report)
- [ ] `.deepsec` pnpm addressed; `plans/README.md` updated

## STOP conditions

- TS6 surfaces non-trivial errors in bug-handler (semantic changes needed) —
  report the error list.
- Depcruise, after de-noising, reports genuine cycles in `apps/dashboard/src`
  — record them (README index "Findings considered" or a new issue), don't fix
  in this plan.
- Any real reference to `design-system/` exists — skip Step 4 and report.

## Maintenance notes

- Renovate/dependabot config (if present) should keep the React/TS floors in
  sync across the isolated workspaces — check `.github/renovate*` while in here
  and note whether it covers per-app manifests.
