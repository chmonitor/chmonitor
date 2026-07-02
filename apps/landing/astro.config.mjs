import { fileURLToPath } from 'node:url'
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://chmonitor.dev',
  // React is scoped to a single hero-background island (rendered via a
  // `client:visible` directive); the rest of the site stays static Astro.
  integrations: [sitemap(), react()],
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
