import { createFileRoute } from '@tanstack/react-router'

import { buildLlmsTxt } from '@/lib/crawler-index'
import { source } from '@/lib/source'

// /llms.txt — every documentation page (title, URL, description, .md twin).
// Follows the llms.txt convention: https://llmstxt.org
export const Route = createFileRoute('/llms.txt')({
  server: {
    handlers: {
      GET() {
        const pages = source.getPages().map((page) => ({
          url: page.url,
          title: page.data.title,
          description: page.data.description,
        }))
        return new Response(buildLlmsTxt(pages), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      },
    },
  },
})
