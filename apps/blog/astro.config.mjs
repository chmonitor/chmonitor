import { fileURLToPath } from 'node:url'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://blog.chmonitor.dev',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // Nav/Footer reuse landing chrome (GitHub stars, changelog, use-cases).
    server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  },
})
