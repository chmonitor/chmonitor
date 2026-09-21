import { fileURLToPath } from 'node:url'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://blog.chmonitor.dev',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        // Shared nav model pulled in transitively by the landing Nav.astro
        // chrome this site reuses (zero-dep package, bundled from source).
        '@chm/site-nav': fileURLToPath(
          new URL('../../packages/site-nav/src/index.ts', import.meta.url)
        ),
      },
    },
    // Nav/Footer reuse landing chrome (GitHub stars, changelog, use-cases).
    server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  },
})
