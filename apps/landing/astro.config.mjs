import { fileURLToPath } from 'node:url'
import sitemap from '@astrojs/sitemap'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://chmonitor.dev',
  // Mostly static. The hero is a single interactive shadcn React island
  // (client:load); every other section stays zero-JS static markup.
  integrations: [sitemap(), react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        // Shared single source of truth for pricing (also used by the dashboard).
        // Zero-dep pure-data package, so importing it drags no app deps in.
        '@chm/pricing': fileURLToPath(
          new URL('../../packages/pricing/src/index.ts', import.meta.url)
        ),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // The package source lives outside the app root; allow Vite to read it.
    server: { fs: { allow: ['../..'] } },
  },
})
