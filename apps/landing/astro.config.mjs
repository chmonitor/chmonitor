import { fileURLToPath } from 'node:url'
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://chmonitor.dev',
  // Fully static: no framework islands, no client-side hydration.
  integrations: [sitemap()],
  vite: {
    resolve: {
      alias: {
        // Shared single source of truth for pricing (also used by the dashboard).
        // Zero-dep pure-data package, so importing it drags no app deps in.
        '@chm/pricing': fileURLToPath(
          new URL('../../packages/pricing/src/index.ts', import.meta.url)
        ),
      },
    },
    // The package source lives outside the app root; allow Vite to read it.
    server: { fs: { allow: ['../..'] } },
  },
})
