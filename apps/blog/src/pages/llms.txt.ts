import type { APIContext } from 'astro'

import { isPublished } from '../lib/published'
import { postSlug } from '../lib/slug'
import { getCollection } from 'astro:content'

// /llms.txt — structured index of all blog posts for AI crawlers.
// Follows the llms.txt convention: https://llmstxt.org
export async function GET(context: APIContext) {
  const posts = (
    await getCollection('blog', ({ data }) => isPublished(data))
  ).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())

  const lines = [
    '# chmonitor blog',
    '',
    'Release notes, product updates, how-to guides, and ClickHouse diagnostic deep-dives from the team building the open-source ClickHouse monitoring dashboard.',
    '',
    `> Latest: ${posts[0]?.data.title ?? 'n/a'}`,
    '',
    '## Posts',
    '',
    ...posts.map((post) => {
      const url = new URL(`/${postSlug(post)}/`, context.site).toString()
      return `- [${post.data.title}](${url}): ${post.data.description}`
    }),
    '',
  ]

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
