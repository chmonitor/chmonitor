import { discoverDocPages } from './scripts/discover-doc-pages.mjs'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import mdx from 'fumadocs-mdx/vite'
import { defineConfig } from 'vite'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Fumadocs TanStack Start docs site — Cloudflare Workers target.
//
// Plugin order is load-bearing:
//  - mdx()          must come BEFORE cloudflare() so MDX files are processed
//                   before the CF plugin transforms the server environment.
//  - cloudflare()   retargets the SSR env to workerd; MUST precede tanstackStart().
//  - tanstackStart() configures routing + prerender.
//  - viteReact()    must come AFTER tanstackStart().
//  - tailwindcss()  order-independent; kept last by convention.
//
// fumadocs-mdx 15.x generates `import.meta.glob` calls with a `"base"` option.
// This requires Vite 8+ (where `"base"` was added to the known glob options set).
// Vite 6.x would throw `Unknown glob option "base"` — that is why this project
// pins Vite to ^8.0.16 and must not be downgraded.
//
// Note: @cloudflare/vite-plugin does NOT support `ssr.external` in the CF
// environment. @takumi-rs/image-response (Takumi OG images) is therefore not
// compatible with CF Workers in this build configuration. The OG route falls
// back to serving /og/og.png for all pages. See PR description for details.
export default defineConfig({
  plugins: [
    mdx(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart({
      // Explicitly enumerate every generated doc page (content/docs/**/*.mdx)
      // so prerender covers all of them, not just what the crawl can reach.
      // The docs landing page renders its nav client-side, so `/` has no
      // server-rendered <a href> links for the crawl to follow — without this,
      // crawlLinks silently prerenders only `/` and a render crash on any
      // content page never fails the build. See scripts/discover-doc-pages.mjs.
      pages: discoverDocPages(),
      prerender: {
        // Prerender all doc pages at build time for fast first paint.
        // The crawl still follows <a> links starting from /, on top of the
        // explicit `pages` list above. failOnError defaults to true, so a
        // page that throws while rendering fails `pnpm run build`.
        enabled: true,
        crawlLinks: true,
        filter: (page: { path: string }) =>
          !page.path.includes('?') && !page.path.includes('#'),
      },
      spa: { enabled: true },
    }),
    viteReact(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // @/* maps src root; tsconfig paths are not auto-applied by all builds.
      '@': r('./src'),
      // collections/* maps to fumadocs-mdx generated .source/ files.
      // Required because tsconfig `paths` aren't automatically hoisted into Vite.
      'collections/browser': r('./.source/browser.ts'),
      'collections/server': r('./.source/server.ts'),
      'collections/dynamic': r('./.source/dynamic.ts'),
    },
  },
  server: {
    port: 3001,
    fs: { allow: ['../..'] },
  },
})
