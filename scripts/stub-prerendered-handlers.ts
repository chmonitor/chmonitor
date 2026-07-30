#!/usr/bin/env bun

/**
 * Empties server handlers for routes whose response is fully known at build
 * time. The webpack chunks they import (large shared chunks like 2918.js ≈
 * 1 MB) then tree-shake out of `handler.mjs` when opennextjs-cloudflare
 * bundles. Cloudflare's ASSETS binding serves the prerendered response
 * directly, so the Worker is never invoked for these paths in practice.
 *
 * Runs after `next build` and before `opennextjs-cloudflare build --skipBuild`.
 *
 * Targets:
 *   • Non-dynamic prerendered pages (e.g. /overview) — every request matches
 *     a `.html` asset, the handler is dead code.
 *   • Dynamic pages with `fallback: false` (e.g. /docs/[[...slug]]) — known
 *     slugs match assets; unknown slugs are 404ed by Next's runtime BEFORE it
 *     invokes the page handler (per Next's `dynamicParams: false` semantics).
 *   • Prerendered route handlers (e.g. /icon.svg) — the response body lives
 *     next to the handler at `<route>.body` and is copied to ASSETS by
 *     `copy-prerendered-to-assets.ts`.
 *
 * Skipped: `/_not-found` (Worker fallback for unrouted requests) and routes
 * we couldn't safely classify.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

interface PrerenderManifest {
  routes?: Record<
    string,
    { srcRoute?: string | null; dataRoute?: string | null }
  >
  dynamicRoutes?: Record<string, { fallback?: false | string | null }>
}

interface AppPathRoutesManifest {
  [appPath: string]: string
}

const ROOT = process.cwd()
// In a monorepo (lockfile at the repo root, app under e.g. `apps/dashboard`),
// `output: 'standalone'` nests the build under the app's path relative to the
// monorepo root: `.next/standalone/apps/dashboard/.next/server/app`. Detect that
// package sub-path the same way opennextjs/aws does (first lockfile walking up)
// so this works in both single-package and monorepo layouts.
function findMonorepoRoot(start: string): string {
  const LOCKFILES = [
    'bun.lockb',
    'bun.lock',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
  ]
  let cur = start
  while (cur !== path.dirname(cur)) {
    if (LOCKFILES.some((f) => existsSync(path.join(cur, f)))) return cur
    cur = path.dirname(cur)
  }
  return start
}
const PKG_PATH = path.relative(findMonorepoRoot(ROOT), ROOT) // '' or e.g. 'apps/dashboard'
// `output: 'standalone'` produces a self-contained copy under `.next/standalone`
// that opennextjs-cloudflare uses as its source of truth. We have to stub there
// (and also in `.next/server/app` for symmetry) — the plain copy alone is ignored.
const APP_ROOTS = [
  path.join(ROOT, '.next/standalone', PKG_PATH, '.next/server/app'),
  path.join(ROOT, '.next/server/app'),
]
// Originals are copied here before stubbing so `restore-prerendered-handlers.ts`
// can put them back after opennext has bundled. Without this, `bun run start`
// (which runs `next start` against `.next/standalone/`) would serve empty
// stubs for every prerendered page.
const BACKUP_ROOT = path.join(ROOT, '.cf-stub-backup')
const PRERENDER_MANIFEST = path.join(ROOT, '.next/prerender-manifest.json')
const APP_PATH_ROUTES_MANIFEST = path.join(
  ROOT,
  '.next/app-path-routes-manifest.json'
)

for (const p of [...APP_ROOTS, PRERENDER_MANIFEST, APP_PATH_ROUTES_MANIFEST]) {
  if (!existsSync(p)) {
    console.error(`Required path missing: ${p}. Did 'next build' run first?`)
    process.exit(1)
  }
}

const prerender: PrerenderManifest = await Bun.file(PRERENDER_MANIFEST).json()
const appPathRoutes: AppPathRoutesManifest = await Bun.file(
  APP_PATH_ROUTES_MANIFEST
).json()

const routeToAppPath = new Map<string, string>()
for (const [appPath, route] of Object.entries(appPathRoutes)) {
  routeToAppPath.set(route, appPath)
}

// Always falls through to the Worker for unrouted requests — never stub.
const SKIP_ROUTES = new Set(['/_not-found'])

// Dynamic routes are only safe to stub when `fallback: false` (a.k.a.
// `dynamicParams: false` in source) — Next 404s unknown params without
// invoking the page handler.
const safeFallbackFalseDynamic = new Set<string>(
  Object.entries(prerender.dynamicRoutes ?? {})
    .filter(([, info]) => info.fallback === false)
    .map(([route]) => route)
)

const srcRoutes = new Set<string>()
for (const [route, info] of Object.entries(prerender.routes ?? {})) {
  srcRoutes.add(info.srcRoute || route)
}
// Dynamic catch-alls only appear in `dynamicRoutes`, not as srcRoute on the
// individual prerendered entries — add them explicitly.
for (const route of safeFallbackFalseDynamic) {
  srcRoutes.add(route)
}

// Empty webpack module shape — valid JS, zero imports, zero chunk references,
// so esbuild can drop every chunk the original handler used to pull in.
const PAGE_STUB =
  '"use strict";(()=>{var a={};a.id=0;a.ids=[0];a.modules={};module.exports=a})();\n'

// Route handlers (route.js) need an async GET stub so any defensive runtime
// lookup gets a Response back instead of crashing. In practice ASSETS serves
// the prerendered `.body` first, so this is belt-and-braces.
const ROUTE_STUB = `"use strict";
const stub = () => new Response(null, { status: 404 });
module.exports = { GET: stub, HEAD: stub, POST: stub, PUT: stub, DELETE: stub, PATCH: stub, OPTIONS: stub };
`

// Routes that live in a separate Cloudflare Worker (see apps/mcp/wrangler.toml).
// Workers Routes intercept these paths before the main worker is invoked, so
// the route handlers we strip here are pure dead code in production. Without
// this stub they pulled the @modelcontextprotocol/server + lib/mcp/tools transitive
// graph (~390 KB minified) into the main bundle.
const EXTERNAL_WORKER_ROUTES: { route: string; appPath: string }[] = [
  { route: '/api/mcp', appPath: '/api/mcp/route' },
  { route: '/api/v1/mcp/info', appPath: '/api/v1/mcp/info/route' },
]

function rscManifestStub(appPath: string): string {
  return `globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST[${JSON.stringify(appPath)}]={};\n`
}

const stubbedPages: string[] = []
const stubbedRoutes: string[] = []
const skipped: string[] = []

// Fresh start: discard any stale backup from an interrupted previous run, so
// the originals captured here always reflect what `next build` just produced.
if (existsSync(BACKUP_ROOT))
  rmSync(BACKUP_ROOT, { recursive: true, force: true })

function backup(file: string): void {
  const rel = path.relative(ROOT, file)
  const target = path.join(BACKUP_ROOT, rel)
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(file, target)
}

function tryStub(
  _src: string,
  appPath: string,
  isRouteHandler: boolean
): boolean {
  let wroteAny = false
  for (const root of APP_ROOTS) {
    const handler = path.join(root, `${appPath}.js`)
    if (!existsSync(handler)) continue
    backup(handler)
    writeFileSync(handler, isRouteHandler ? ROUTE_STUB : PAGE_STUB)
    if (!isRouteHandler) {
      const rscManifestJs = path.join(
        root,
        `${appPath.replace(/\/page$/, '/page_client-reference-manifest')}.js`
      )
      if (existsSync(rscManifestJs)) {
        backup(rscManifestJs)
        writeFileSync(rscManifestJs, rscManifestStub(appPath))
      }
    }
    wroteAny = true
  }
  return wroteAny
}

for (const src of srcRoutes) {
  if (SKIP_ROUTES.has(src)) {
    skipped.push(`${src} (always falls back to Worker)`)
    continue
  }
  if (src.includes('[') && !safeFallbackFalseDynamic.has(src)) {
    skipped.push(`${src} (dynamic with fallback != false — handler needed)`)
    continue
  }

  const appPath = routeToAppPath.get(src)
  if (!appPath) {
    skipped.push(`${src} (no app path mapping)`)
    continue
  }
  const isRouteHandler = appPath.endsWith('/route')
  // For route handlers, only stub when ASSETS will actually serve the body —
  // the `.body` file is what `copy-prerendered-to-assets.ts` puts in assets.
  if (isRouteHandler) {
    const bodyFile = path.join(
      ROOT,
      '.next/server/app',
      `${src.replace(/^\//, '')}.body`
    )
    if (!existsSync(bodyFile)) {
      skipped.push(`${src} (route handler with no prerendered body)`)
      continue
    }
  }

  if (!tryStub(src, appPath, isRouteHandler)) {
    skipped.push(`${src} (no handler file found)`)
    continue
  }
  ;(isRouteHandler ? stubbedRoutes : stubbedPages).push(src)
}

const stubbedExternal: string[] = []
for (const { route, appPath } of EXTERNAL_WORKER_ROUTES) {
  if (tryStub(route, appPath, true)) {
    stubbedExternal.push(route)
  } else {
    skipped.push(`${route} (external-worker stub: handler file missing)`)
  }
}

console.log(
  `Stubbed ${stubbedPages.length} page handlers + ${stubbedRoutes.length} prerendered route handlers + ${stubbedExternal.length} external-worker routes.`
)
for (const r of stubbedExternal) console.log(`  external: ${r}`)
for (const r of stubbedPages) console.log(`  page: ${r}`)
for (const r of stubbedRoutes) console.log(`  route: ${r}`)
if (skipped.length > 0) {
  console.log(`Skipped ${skipped.length}:`)
  for (const r of skipped) console.log(`  ${r}`)
}
