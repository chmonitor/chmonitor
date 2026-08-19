import { fileURLToPath } from 'node:url'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://blog.chmonitor.dev',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // Nav reuses landing's GitHub stars helper (one fetch, fail-open).
    server: { fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
  },
})
