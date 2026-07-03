import type { APIContext } from 'astro'

import { postSlug } from '../lib/slug'
import { getCollection } from 'astro:content'
import rss from '@astrojs/rss'

export async function GET(context: APIContext) {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf()
  )

  return rss({
    title: "What's new in chmonitor",
    description:
      'Release notes, product updates and engineering notes from the team building the open-source ClickHouse monitoring dashboard.',
    site: context.site ?? 'https://blog.chmonitor.dev',
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/${postSlug(post)}/`,
      categories: [post.data.tag],
    })),
    customData: '<language>en-us</language>',
  })
}
