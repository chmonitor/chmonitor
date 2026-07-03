import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig, type PluginOption } from 'vite'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// ─────────────────────────────────────────────────────────────────────────────
// Build-time client env (`import.meta.env.VITE_*`).
//
// Vite/TanStack inline `import.meta.env.VITE_*` into BOTH the client and server
// bundles at build time — the equivalent of Next's `NEXT_PUBLIC_*` inlining.
// Cloudflare Worker `[vars]` are RUNTIME-only and never reach the client bundle,
// so anything the browser needs at build time lives here, not in wrangler vars.
//
// Values come from `process.env.VITE_*` (CI overrides — e.g. the pk_test Clerk
// key for preview deploys) with non-secret committed defaults that mirror
// `scripts/patch-wrangler-env.ts`. The Clerk publishable key has NO committed
// default — it comes only from the build env so a missing key cleanly disables
// Clerk (isClerkEnabled() → false) rather than silently re-enabling it.
function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

// Single source of truth for the hosted (cloud) build's non-secret config:
// the committed `.env.production` (+ `.env.preview` overlay). The CF deploy sets
// CHM_BUILD_ENV=production|preview (see package.json build:production / build:preview);
// Docker / self-host / dev builds set neither → no cloud file is folded in, so
// CLIENT_ENV falls back to the self-hosted-safe defaults below (cloud OFF).
// process.env (CI overrides, shell exports) always wins over the file.
function parseDotenv(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const raw of readFileSync(path, 'utf-8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    out[line.slice(0, eq).trim()] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }
  return out
}
function loadDeployEnv(): Record<string, string> {
  const mode = process.env.CHM_BUILD_ENV
  // `.env.<mode>.local` (gitignored) overlays the committed `.env.<mode>` — it
  // carries the de-committed platform values (e.g. CHM_CLERK_PUBLISHABLE_KEY) for
  // LOCAL builds. SAFE: only the allowlisted VITE_* in CLIENT_ENV reach the
  // bundle, so any secret in the .local file is read but never inlined. In CI the
  // values come from process.env (GitHub vars) instead, which wins below.
  if (mode === 'production') {
    return {
      ...parseDotenv(r('./.env.production')),
      ...parseDotenv(r('./.env.production.local')),
    }
  }
  if (mode === 'preview') {
    return {
      ...parseDotenv(r('./.env.production')),
      ...parseDotenv(r('./.env.production.local')),
      ...parseDotenv(r('./.env.preview')),
      ...parseDotenv(r('./.env.preview.local')),
    }
  }
  return {}
}

// Unified env lookup. Each dual-surface setting has ONE canonical name (CHM_*);
// the client VITE_* below derives from it, so `CHM_AUTH_PROVIDER` /
// `CHM_CLOUD_MODE` / `CHM_FEATURE_*` are set ONCE and reach both the server
// (process.env) and the browser bundle. Precedence per var:
//   explicit VITE_* → canonical CHM_* → legacy NEXT_PUBLIC_* → committed default.
// Only PUBLIC vars live here — never a runtime secret (security boundary).
const e: Record<string, string | undefined> = {
  ...loadDeployEnv(),
  ...process.env,
}
// Deployment profile drives the client defaults below, mirroring the server
// (lib/config/deployment-mode.ts). `CHM_DEPLOYMENT_MODE=cloud` alone flips cloud mode, clerk
// auth, public-read, and per-user storage on — each still overridable by its
// explicit VITE_*/CHM_* var. Fail-closed: anything but cloud/saas → self-hosted.
const _profile = (e.CHM_DEPLOYMENT_MODE ?? e.VITE_DEPLOYMENT_MODE ?? '')
  .trim()
  .toLowerCase()
const isCloud = _profile === 'cloud' || _profile === 'saas'
const CLIENT_ENV = {
  // Expose the resolved profile so client code can read it directly.
  VITE_DEPLOYMENT_MODE:
    e.VITE_DEPLOYMENT_MODE ??
    e.CHM_DEPLOYMENT_MODE ??
    (isCloud ? 'cloud' : 'oss'),
  VITE_AUTH_PROVIDER:
    e.VITE_AUTH_PROVIDER ??
    e.CHM_AUTH_PROVIDER ??
    e.NEXT_PUBLIC_AUTH_PROVIDER ??
    (isCloud ? 'clerk' : 'none'),
  // No committed default: the publishable key comes ONLY from the build env
  // (CI sets VITE_CLERK_PUBLISHABLE_KEY — pk_test for previews, pk_live for prod;
  // see .github/workflows/cloudflare.yml). With no key, isClerkEnabled() returns
  // false and Clerk cleanly disables — the app runs unauthenticated, no crash.
  VITE_CLERK_PUBLISHABLE_KEY:
    e.VITE_CLERK_PUBLISHABLE_KEY ??
    e.CHM_CLERK_PUBLISHABLE_KEY ??
    e.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    '',
  VITE_FEATURE_CONVERSATION_DB:
    e.VITE_FEATURE_CONVERSATION_DB ??
    e.CHM_FEATURE_CONVERSATION_DB ??
    e.NEXT_PUBLIC_FEATURE_CONVERSATION_DB ??
    (isCloud ? 'true' : 'false'),
  VITE_FEATURE_USER_CONNECTIONS_DB:
    e.VITE_FEATURE_USER_CONNECTIONS_DB ??
    e.CHM_FEATURE_USER_CONNECTIONS_DB ??
    e.NEXT_PUBLIC_FEATURE_USER_CONNECTIONS_DB ??
    (isCloud ? 'true' : 'false'),
  VITE_AUTOCOMPLETE_LIMIT:
    e.VITE_AUTOCOMPLETE_LIMIT ?? e.NEXT_PUBLIC_AUTOCOMPLETE_LIMIT ?? '',
  VITE_RUNNING_QUERIES_REFRESH_MS:
    e.VITE_RUNNING_QUERIES_REFRESH_MS ??
    e.NEXT_PUBLIC_RUNNING_QUERIES_REFRESH_MS ??
    '',
  // Edition: 'community' (default, OSS, fail-open) | 'enterprise' (paid).
  // Unset or unrecognised values always resolve to 'community' in parseEdition().
  VITE_EDITION: e.VITE_EDITION ?? e.CHM_EDITION ?? 'community',
  // Cloud (SaaS) mode: 'true' on dash.chmonitor.dev, unset everywhere else.
  // When on, env hosts are a public read-only demo and signed-in users get a
  // clean per-user workspace. Unset/junk → self-hosted (OSS) behaviour, never
  // degraded. See lib/cloud/cloud-mode.ts.
  VITE_CLOUD_MODE:
    e.VITE_CLOUD_MODE ?? e.CHM_CLOUD_MODE ?? (isCloud ? 'true' : ''),
  // Anonymous product telemetry: ON by default — opt out with VITE_TELEMETRY_ENABLED=off
  // (or 0/false/no), VITE_DO_NOT_TRACK / DO_NOT_TRACK, or an empty endpoint.
  VITE_TELEMETRY_ENABLED:
    e.VITE_TELEMETRY_ENABLED ?? e.NEXT_PUBLIC_TELEMETRY_ENABLED ?? 'on',
  // DO_NOT_TRACK opt-out (https://consoledonottrack.com). Hard override — any
  // truthy value forces telemetry off. Mirrors the server DO_NOT_TRACK var.
  VITE_DO_NOT_TRACK: e.VITE_DO_NOT_TRACK ?? e.DO_NOT_TRACK ?? '',
  // Deployment target (docker | helm | cf | dev | unknown). Set in CI build
  // steps so telemetry can distinguish deployment environments.
  VITE_DEPLOY_TARGET: e.VITE_DEPLOY_TARGET ?? 'unknown',
  // Collection endpoint for the daily instance ping. Defaults to the project
  // collector (must match DEFAULT_TELEMETRY_ENDPOINT in lib/telemetry/instance-ping.ts);
  // set to a different URL to self-host, or to '' as a hard no-network kill-switch.
  VITE_TELEMETRY_ENDPOINT:
    e.VITE_TELEMETRY_ENDPOINT ?? 'https://telemetry.chmonitor.dev/v1/ping',
  VITE_GIT_SHA:
    e.VITE_GIT_SHA ?? e.NEXT_PUBLIC_GIT_SHA ?? git('rev-parse HEAD'),
  VITE_GIT_REF:
    e.VITE_GIT_REF ??
    e.NEXT_PUBLIC_GIT_REF ??
    git('rev-parse --abbrev-ref HEAD'),
  VITE_BUILD_TIMESTAMP:
    e.VITE_BUILD_TIMESTAMP ??
    e.NEXT_PUBLIC_BUILD_TIMESTAMP ??
    new Date().toISOString(),
  VITE_CI: e.VITE_CI ?? e.NEXT_PUBLIC_CI ?? (e.CI ? 'true' : ''),
  // Query-config source: 'ts' (default, current TS configs) | 'declarative'
  // (load from external declarative catalog). Anything other than 'declarative'
  // falls back to 'ts' — fail-safe to the current behaviour. DARK: no views
  // use declarative configs yet.
  VITE_CONFIG_SOURCE: e.VITE_CONFIG_SOURCE ?? 'ts',
  // Sentry (error tracking). Disabled unless a DSN is set — the OSS default;
  // self-hosters opt in with CHM_SENTRY_DSN. The hosted product sets it in
  // .env.production. The DSN is a public client-side value (safe to inline).
  VITE_SENTRY_DSN: e.VITE_SENTRY_DSN ?? e.CHM_SENTRY_DSN ?? '',
  // Sentry environment label. Defaults to the build env (production|preview);
  // 'development' for local/OSS builds. Server reads the CHM_SENTRY_ENVIRONMENT
  // worker var separately (patch-wrangler-env.ts).
  VITE_SENTRY_ENVIRONMENT:
    e.VITE_SENTRY_ENVIRONMENT ??
    e.CHM_SENTRY_ENVIRONMENT ??
    e.CHM_BUILD_ENV ??
    'development',
  // Browser tracing sample rate (0..1). Empty → SDK default in sentry-options.ts.
  VITE_SENTRY_TRACES_SAMPLE_RATE:
    e.VITE_SENTRY_TRACES_SAMPLE_RATE ?? e.CHM_SENTRY_TRACES_SAMPLE_RATE ?? '',
  // Product analytics (PostHog) — SaaS funnel/conversion tracking, DISTINCT
  // from VITE_TELEMETRY_ENABLED (anonymous OSS instance telemetry, on by
  // default). OFF unless a key is set — self-hosted instances never phone
  // home to a third-party analytics platform by default. See
  // docs/operate/advanced/product-analytics.mdx and lib/analytics/.
  VITE_ANALYTICS_KEY: e.VITE_ANALYTICS_KEY ?? e.CHM_ANALYTICS_KEY ?? '',
  // Self-hostable: point at your own PostHog instance. Empty = PostHog Cloud
  // (US) default (see lib/analytics/analytics.client.ts).
  VITE_ANALYTICS_HOST: e.VITE_ANALYTICS_HOST ?? e.CHM_ANALYTICS_HOST ?? '',
} as const

// Explicit text-replacement of each `import.meta.env.VITE_*` read. Deterministic
// across local + CI builds regardless of Vite's .env-file discovery.
const CLIENT_ENV_DEFINE = Object.fromEntries(
  Object.entries(CLIENT_ENV).map(([k, v]) => [
    `import.meta.env.${k}`,
    JSON.stringify(v),
  ])
)

// ─────────────────────────────────────────────────────────────────────────────
// SSR stub for browser-only render libraries (#1393 worker size limit).
//
// The Cloudflare Worker is deployed with `no_bundle: true`, so `wrangler deploy`
// uploads EVERY file in `dist/server/assets/*.js` against the free-plan 3 MiB
// limit — including the lazy/dynamic-import chunks that only render in the
// browser. mermaid (+cytoscape, katex, the langium/vscode-langserver parser, all
// diagram renderers) and codemirror are always mounted behind React.lazy /
// <ClientOnly> / Suspense, so they NEVER execute during SSR or prerender. Replace
// them with an empty stub in the worker (`ssr`) environment only; the client
// build keeps the real implementations, so runtime behaviour is unchanged.
//
// Matching by bare-specifier prefix covers package entries AND subpaths
// (`@codemirror/view`, `mermaid/dist/...`). Internal relative chunks of these
// packages disappear automatically once their bare entry resolves to the stub.
const SSR_STUB_PREFIXES = [
  'mermaid',
  'cytoscape',
  '@mermaid-js/',
  'katex',
  'dagre',
  '@dagrejs/dagre',
  '@codemirror/',
  'codemirror',
  // SQL beautify (sql-formatter, ~484K). Imported statically in 4 dialog/editor
  // components, but `format()` only runs on user interaction — beautify defaults
  // OFF and getInitialBeautifyState() returns false under SSR (no `window`), so
  // it never executes during prerender. Stub it out of the worker bundle.
  'sql-formatter',
  // recharts (~1 MiB raw). All recharts consumers are client-only: full chart
  // components load via React.lazy() through the chart registry, and KpiCard
  // sparklines guard recharts behind `spark && spark.length >= 2` which is
  // always false during prerender (TanStack Query data is empty). Stubbing this
  // out of the worker bundle is the single largest remaining size win.
  'recharts',
  // Streaming markdown renderer — only used in assistant-ui / ai-elements
  // components behind React.lazy boundaries (agent-thread-page,
  // global-assistant-modal-impl). Never executes during SSR/prerender.
  'streamdown',
  '@streamdown',
  // React Flow graph visualization (~372 KB with d3-* deps). The explorer route
  // lazy-loads the entire DependencyGraph via React.lazy + Suspense, so xyflow
  // never executes during SSR or prerender.
  '@xyflow/react',
  // highlight.js (~106K chunk). Imported in code-block.tsx. highlightCode() runs
  // inside useMemo guarded by `if (!displaySQL) return ''` — during SSR/prerender
  // sql metadata is undefined so the function is never invoked.
  'highlight.js',
  // @assistant-ui/react + react-ai-sdk (~1.5 MB thread chunk). All assistant-ui
  // code is behind React.lazy in agents-page-client.tsx and
  // global-assistant-modal.tsx. Also drops transitive deps: assistant-cloud,
  // remend, emenda-carousel, vaul, hast/rehype/marked, nanoid, zustand, dequal.
  '@assistant-ui/react',
  '@assistant-ui/react-ai-sdk',
  // @json-render/shadcn (~532 KiB) + @json-render/react (~20 KiB). Only imported
  // by json-render-registry.ts and json-render-catalog-with-schema.ts, which are
  // consumed exclusively by the lazy-loaded assistant-ui components (json-render-
  // message.tsx behind React.lazy). The server-side API route (api/v1/agent.ts)
  // only imports @json-render/core (~60 KiB, must NOT be stubbed).
  '@json-render/shadcn',
  '@json-render/react',
  // assistant-stream (~15 KiB gz). Only imported by d1-thread-list-adapter.tsx
  // and local-thread-list-adapter.tsx, both behind React.lazy in the agent thread.
  // Never executes during SSR or prerender.
  'assistant-stream',
]

// rolldown does not honour `syntheticNamedExports` from a resolveId result, so
// the stub must declare every named export an app source file imports from a
// stubbed package (transitive node_modules importers use default/namespace
// imports and don't need this). These are the only `@codemirror/*` named
// imports in the codebase — see src/components/explorer/sql-editor.tsx.
const SSR_STUB_NAMED_EXPORTS = [
  'autocompletion',
  'completionKeymap',
  'defaultKeymap',
  'history',
  'historyKeymap',
  'sql',
  'bracketMatching',
  'defaultHighlightStyle',
  'syntaxHighlighting',
  'searchKeymap',
  'Compartment',
  'EditorState',
  'Transaction',
  'placeholder',
  'EditorView',
  'keymap',
  // sql-formatter
  'format',
  // recharts — all named imports from src/ (rolldown doesn't honour
  // syntheticNamedExports; `import * as RechartsPrimitive` and `import type`
  // need no entry — namespace uses the Proxy default; types are erased).
  'Area',
  'AreaChart',
  'Bar',
  'BarChart',
  'CartesianGrid',
  'Cell',
  'ComposedChart',
  'Label',
  'LabelList',
  'Line',
  'Pie',
  'PieChart',
  'RadialBar',
  'RadialBarChart',
  'Scatter',
  'ScatterChart',
  'Tooltip',
  'XAxis',
  'YAxis',
  // streamdown + @streamdown/mermaid
  'Streamdown',
  'mermaid',
  // @xyflow/react (React Flow) — all value imports from src/components/explorer
  // and src/components/ai-elements. Type imports (Edge, Node, ReactFlowProps,
  // etc.) need no entry — they're erased at build time.
  'Background',
  'BaseEdge',
  'BezierEdge',
  'ConnectionLineType',
  'ControlButton',
  'Controls',
  'EdgeLabelRenderer',
  'getBezierPath',
  'getNodesBounds',
  'Handle',
  'MarkerType',
  'MiniMap',
  'NodeResizer',
  'Panel',
  'Position',
  'ReactFlow',
  'SimpleBezierEdge',
  'StepEdge',
  'StraightEdge',
  'useEdges',
  'useEdgesState',
  'useNodes',
  'useNodesState',
  'useReactFlow',
  'ViewportPortal',
  // highlight.js — default export used as `hljs` in code-block.tsx (no named
  // exports needed; the subpath imports like `highlight.js/lib/languages/sql`
  // are matched by the prefix rule).
  // @assistant-ui/react — all named imports used across src/components/assistant-ui/
  // and src/lib/conversation-store/adapter/
  'ActionBarPrimitive',
  'AssistantModalPrimitive',
  'AssistantRuntimeProvider',
  'BranchPickerPrimitive',
  'ComposerPrimitive',
  'EnrichedPartState',
  'ErrorPrimitive',
  'MessagePartStatus',
  'MessagePrimitive',
  'PartState',
  'RuntimeAdapterProvider',
  'ThreadListItemPrimitive',
  'ThreadListPrimitive',
  'ThreadPrimitive',
  'ToolCallMessagePartStatus',
  'useAui',
  'useMessage',
  'useMessageTiming',
  'useRemoteThreadListRuntime',
  'useScrollLock',
  'useThread',
  'useThreadList',
  'useThreadListItem',
  'useThreadRuntime',
  // @assistant-ui/react-ai-sdk
  'useChatRuntime',
  // @json-render/react — value imports from json-render-catalog-with-schema.ts,
  // json-render-registry.ts, and json-render-message.tsx. (type imports like
  // DataPart are erased at build time and need no entry).
  'schema',
  'defineRegistry',
  'getTextFromParts',
  'Renderer',
  'useJsonRenderMessage',
  // @json-render/shadcn — value import from json-render-registry.ts.
  'shadcnComponents',
  // @json-render/shadcn/catalog — value import from json-render-catalog-with-schema.ts.
  'shadcnComponentDefinitions',
  // assistant-stream — named import from d1-thread-list-adapter.tsx and
  // local-thread-list-adapter.tsx (both behind React.lazy agent boundary).
  'createAssistantStream',
]

const SSR_STUB_VIRTUAL_ID = '\0chm-ssr-client-only-stub'

function isStubbedSpecifier(id: string): boolean {
  return SSR_STUB_PREFIXES.some(
    (p) =>
      id === p ||
      id.startsWith(`${p}/`) ||
      (p.endsWith('/') && id.startsWith(p))
  )
}

function ssrClientOnlyStub(): PluginOption {
  // Virtual module: a Proxy default export (covers default/namespace imports of
  // mermaid/katex/cytoscape) plus explicit named aliases for the codemirror
  // symbols. The modules only execute meaningfully inside browser effects /
  // lazy chunks the worker never reaches, BUT some are evaluated at module
  // top-level / during render at prerender time (e.g. `defineRegistry(...).registry`
  // in json-render-registry.ts, or `new dagre.graphlib.Graph().setDefaultEdgeLabel()`
  // in dagre-layout.ts). So `get`/`apply`/`construct` all return the chainable
  // `stub` — property access, calls, AND `new X().chain()` stay safe and never throw.
  // The Proxy target MUST be a regular `function` (not an arrow): a Proxy only
  // exposes [[Construct]] when its target is constructable, so an arrow target
  // would make `new stub()` throw "is not a constructor" before the trap fires.
  const namedExports = SSR_STUB_NAMED_EXPORTS.map(
    (n) => `export const ${n} = stub`
  ).join('\n')
  const code = `function noop() {}
const stub = new Proxy(noop, {
  get(_t, p) {
    if (p === '__esModule') return true
    if (p === 'default') return stub
    // Array-destructured hook results (e.g. \`const [n, setN, onChange] =
    // useNodesState(...)\` in dependency-graph.tsx) require the stub to be
    // iterable, or prerender throws "is not a function or its return value is
    // not iterable". Yield a bounded number of stubs: enough for any hook
    // tuple, finite so an accidental spread can't hang the build.
    if (p === Symbol.iterator) {
      return function* () {
        for (let i = 0; i < 8; i++) yield stub
      }
    }
    if (typeof p === 'symbol') return undefined
    return stub
  },
  apply() { return stub },
  construct() { return stub },
})
export default stub
${namedExports}
`
  return {
    name: 'chm:ssr-client-only-stub',
    enforce: 'pre',
    resolveId(id) {
      // The stub exists ONLY to keep the Cloudflare Worker under the free-plan
      // 3 MiB limit (#1393). The Node/Docker target has no size limit and its
      // prerender needs the REAL libs — e.g. computeDagrePositions (PeerGraph)
      // calls dagre during SSR — so never stub when BUILD_TARGET=node.
      if (isNode) return null
      // `this.environment` is the per-environment build context (Vite 6+/8).
      // Only stub in the worker/SSR environment, never the browser client build.
      if (this.environment?.name === 'client') return null
      if (isStubbedSpecifier(id)) return SSR_STUB_VIRTUAL_ID
      return null
    },
    load(id) {
      if (id === SSR_STUB_VIRTUAL_ID) return code
      return null
    },
  }
}
// ─────────────────────────────────────────────────────────────────────────────

// Dual build target from ONE source (#1409):
//  - default / BUILD_TARGET=cloudflare: @cloudflare/vite-plugin → workerd bundle
//    (the proven, merged CF path; deployed by `wrangler deploy`).
//  - BUILD_TARGET=node: drop @cloudflare/vite-plugin, add nitro() node-server
//    preset → .output/server/index.mjs for the Docker image. Same routes, same
//    @chm/* seam; `cloudflare:workers` is aliased to a process.env shim so the
//    routes' static `import { env } from 'cloudflare:workers'` resolves on Node.
const isNode = process.env.BUILD_TARGET === 'node'

// Plugin order is load-bearing:
//  - CF: cloudflare() retargets the SSR env to workerd and MUST precede
//    tanstackStart(); viteReact() MUST come after tanstackStart().
//  - Node: nitro() goes AFTER tanstackStart() (per TanStack hosting docs); no
//    cloudflare() plugin.
// tailwindcss() (Tailwind v4) is order-independent; kept first by convention.
// Static prerender: emit per-route static HTML at build (fast first paint,
// served via Cloudflare Workers Assets / Docker static files), with a SPA
// fallback shell for any non-crawled route. Dynamic data still loads
// client-side via TanStack Query against the API routes — "fast like SSR".
//
// `CHM_SKIP_PRERENDER=1` turns prerender OFF for the e2e CI build only. The
// Node-target prerender crawls all 119 routes running the un-stubbed real
// render libs (dagre/recharts/mermaid) and takes >30 min on a CI runner — it
// was cancelled mid-prerender before the e2e specs could run. e2e doesn't need
// prerendered HTML: `spa.enabled` already serves a fallback shell for every
// route, and the specs assert RUNTIME behaviour with data fetched client-side
// (identical whether a route arrives prerendered or as the SPA shell). The
// production Docker build does NOT set this flag, so prod still prerenders.
const skipPrerender = process.env.CHM_SKIP_PRERENDER === '1'
const startConfig = {
  prerender: {
    enabled: !skipPrerender,
    crawlLinks: !skipPrerender,
    // HostPrefixedLink renders real hrefs like `/queries?host=0` (#1558), which
    // the crawler picks up. The plugin's withTrailingSlash() appends "/" AFTER
    // the query string (`/queries?host=0/`) → 404 → build failure. Query-string
    // variants prerender the same HTML shell as their base path (data loads
    // client-side), and every base path is already crawled — skip them.
    //
    // Hash-anchor hrefs (docs in-page links like `/docs/x#section`) are crawled
    // the same way, but a literal `#` in the request path matches NO route and
    // the prerender render hangs forever (no timeout) — this stalled the whole
    // Docker build crawl indefinitely. Anchors are client-side only and render
    // the identical shell as their already-crawled base path, so skip them too.
    filter: (page: { path: string }) =>
      !page.path.includes('?') && !page.path.includes('#'),
  },
  spa: { enabled: true },
}

const runtimePlugins: PluginOption[] = isNode
  ? [tanstackStart(startConfig), nitro({ preset: 'node-server' }), viteReact()]
  : [
      cloudflare({ viteEnvironment: { name: 'ssr' } }),
      tanstackStart(startConfig),
      viteReact(),
    ]

// Sentry source-map upload (build-time only). Active ONLY when SENTRY_AUTH_TOKEN
// is present (CI prod/preview deploys) — local, OSS, and PR-without-token builds
// skip it entirely so they never fail on a missing token. The plugin uploads
// source maps for readable stack traces and injects release/debug ids, then
// deletes the maps from the output so they never ship in the bundle.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const sentryRelease =
  process.env.VITE_GIT_SHA ??
  process.env.NEXT_PUBLIC_GIT_SHA ??
  git('rev-parse HEAD')
const sentryPlugins: PluginOption[] = sentryAuthToken
  ? [
      sentryVitePlugin({
        org: process.env.SENTRY_ORG ?? 'duyet',
        project: process.env.SENTRY_PROJECT ?? 'chm-cloud',
        authToken: sentryAuthToken,
        release: { name: sentryRelease || undefined },
        telemetry: false,
        // Maps are generated (build.sourcemap below), uploaded, then removed.
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
      }),
    ]
  : []

export default defineConfig({
  // Inline client-exposed build-time env (`import.meta.env.VITE_*`). See
  // CLIENT_ENV above — Worker [vars] are runtime-only and never reach the client.
  define: CLIENT_ENV_DEFINE,
  server: {
    port: 3000,
    // Allow Vite to read shared @chm/* package sources outside the app root.
    fs: { allow: ['../..'] },
  },
  resolve: {
    // The @chm/* source packages live at ../../packages and are transpiled into
    // the server bundle (ssr.noExternal). Their npm deps live in THIS app's
    // isolated node_modules (own-lockfile), not on the packages' upward resolve
    // path — dedupe forces these bare specifiers to resolve from the app root.
    dedupe: [
      '@clickhouse/client-web',
      'lru-cache',
      'zod',
      'react',
      'react-dom',
      'lucide-react',
      '@radix-ui/react-icons',
      // React Query's context is per-module-instance. PersistQueryClientProvider
      // (from react-query-persist-client) must resolve the SAME @tanstack/react-query
      // as the app's useQuery hooks, or the provider sets context on one instance
      // while hooks read another → "No QueryClient set". Dedupe to a single copy.
      '@tanstack/react-query',
      '@tanstack/query-core',
      '@tanstack/react-query-persist-client',
      '@tanstack/query-persist-client-core',
      // CodeMirror relies on `instanceof @codemirror/state` checks across its
      // packages (view/lang-sql/etc. each import state). Two copies → "Unrecognized
      // extension value... multiple instances of @codemirror/state are loaded",
      // which crashes the SQL console. Force a single shared instance of each.
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/commands',
      '@codemirror/autocomplete',
      '@codemirror/search',
      '@codemirror/lang-sql',
    ],
    alias: {
      '@': r('./src'),
      // Shared workspace packages resolved from SOURCE — own-lockfile isolation
      // means no `workspace:*` protocol. Vite transpiles them; ssr.noExternal
      // (below) bundles them into the server build rather than externalizing.
      //
      // IMPORTANT: sub-path aliases MUST precede the generic alias so rolldown
      // resolves them correctly (it matches first entry, not longest prefix).
      '@chm/sql-builder': r('../../packages/sql-builder/src/index.ts'),
      '@chm/logger': r('../../packages/logger/src/index.ts'),
      // Specific sub-paths FIRST (before the generic @chm/clickhouse-client)
      '@chm/clickhouse-client/runtime/cloudflare-workers': r(
        '../../packages/clickhouse-client/src/runtime/cloudflare-workers.ts'
      ),
      '@chm/clickhouse-client/clickhouse-version': r(
        '../../packages/clickhouse-client/src/clickhouse-version.ts'
      ),
      '@chm/clickhouse-client/constants': r(
        '../../packages/clickhouse-client/src/clickhouse/constants.ts'
      ),
      '@chm/clickhouse-client/table-existence-cache': r(
        '../../packages/clickhouse-client/src/table-existence-cache.ts'
      ),
      // Generic entry (must be after sub-paths)
      '@chm/clickhouse-client': r(
        '../../packages/clickhouse-client/src/index.ts'
      ),
      '@chm/types': r('../../packages/types/src/index.ts'),
      '@chm/pricing': r('../../packages/pricing/src/index.ts'),
      // Native platform bindings — replaces @chm/platform's @opennextjs/cloudflare
      // adapter with a `cloudflare:workers` env reader (see src/lib/platform-native.ts).
      '@chm/platform': r('./src/lib/platform-native.ts'),
      // MCP subpaths — http.ts re-exports cors/server/data via relative imports
      // that resolve from the package source, so aliasing the entrypoints is enough.
      '@chm/mcp-server/http': r('../../packages/mcp-server/src/http.ts'),
      '@chm/mcp-server/data': r(
        '../../packages/mcp-server/src/data/mcp-tools-data.ts'
      ),
      '@chm/mcp-server/auth': r('../../packages/mcp-server/src/auth/index.ts'),
      // The MCP SDK ships an exact `./server` export that shadows `./server/*`
      // subpaths in rolldown's exports resolution, so point the two used deep
      // imports straight at their dist ESM files (the `./*` wildcard target).
      '@modelcontextprotocol/sdk/server/mcp.js': r(
        './node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js'
      ),
      '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js': r(
        './node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js'
      ),
      // The node @clickhouse/client (node:os/node:stream/TCP) is a dead static
      // import in clickhouse-client.ts (routes force web:true). Alias it to an
      // empty stub so it resolves in the bundle on BOTH targets.
      '@clickhouse/client': r('./src/lib/empty.ts'),
      // Node has no `cloudflare:workers` virtual module — alias the routes'
      // static `import { env } from 'cloudflare:workers'` to a process.env shim.
      ...(isNode
        ? { 'cloudflare:workers': r('./src/lib/cloudflare-workers-shim.ts') }
        : {}),
    },
  },
  ssr: {
    // Transpile + bundle the @chm source packages and their bundleable leaf
    // deps into the server build.
    noExternal: [
      '@chm/sql-builder',
      '@chm/logger',
      '@chm/clickhouse-client',
      '@chm/types',
      '@chm/pricing',
      '@chm/mcp-server',
      '@clickhouse/client-web',
      // client-web's runtime dep. Must be bundled alongside it: the node-server
      // image ships only .output (no node_modules), so a dep left externalized
      // here is absent at runtime. This was the validate-docker timeout cause
      // (container running but every route threw
      // "Cannot find module '@clickhouse/client-common'").
      '@clickhouse/client-common',
      '@modelcontextprotocol/sdk',
      'lru-cache',
      'zod',
    ],
  },
  // Sentry plugin LAST so it sees the final emitted bundle for source-map upload.
  plugins: [
    ssrClientOnlyStub(),
    tailwindcss(),
    ...runtimePlugins,
    ...sentryPlugins,
  ],
  build: {
    // Cloudflare Workers V8 runs ES2022+ natively; avoids needless downleveling.
    target: 'esnext',
    // Emit source maps only when uploading to Sentry (token present). 'hidden'
    // generates the .map files without a sourceMappingURL comment in the JS, so
    // nothing references them in production; the Sentry plugin deletes them
    // post-upload. Off otherwise to keep builds lean.
    sourcemap: sentryAuthToken ? 'hidden' : false,
  },
  optimizeDeps: {
    // Pre-bundle heavy deps to speed cold dev-server start.
    include: [
      '@clickhouse/client-web',
      'lucide-react',
      'recharts',
      'lru-cache',
      // Pre-bundle the whole react-query family together so they share ONE
      // instance in dev. Without persist-client here, Vite leaves it
      // unoptimized and it imports a second react-query → "No QueryClient set".
      '@tanstack/react-query',
      '@tanstack/react-query-persist-client',
      '@tanstack/query-sync-storage-persister',
      // Same single-instance requirement as the dedupe block above — pre-bundle
      // the CodeMirror family together so `instanceof` checks hold in the SQL console.
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/commands',
      '@codemirror/autocomplete',
      '@codemirror/search',
      '@codemirror/lang-sql',
    ],
  },
})
