import type { CollectionEntry } from 'astro:content'

// A blog post is publicly served when it isn't marked `draft` AND its `date`
// is today or in the past. Every page/feed that lists posts must use this
// instead of a raw `!data.draft` check — otherwise a future `date` (e.g. a
// content-calendar placeholder written before the post's real publish date)
// renders live immediately and sorts to the top of "latest" on the homepage,
// llms.txt, and the RSS feed. See #2697.
export function isPublished(data: CollectionEntry<'blog'>['data']): boolean {
  return !data.draft && data.date.valueOf() <= Date.now()
}
