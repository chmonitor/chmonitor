import type { CollectionEntry } from 'astro:content'

// The public URL slug for a post. We prefer the explicit `version` frontmatter
// (e.g. "v0.3" → /v0.3/) over the glob-loader `id`, because Astro slugifies the
// filename and would strip the dot (v0.3 → v0-3). Falls back to `id` for posts
// without a version.
export function postSlug(post: CollectionEntry<'blog'>): string {
  return post.data.version ?? post.id
}

// URL-safe slug for a category tag. Tag frontmatter like "5 min of
// ClickHouse" becomes a path segment ("5-min-of-clickhouse"). Resolve back to
// the original tag by scanning posts (tags are free-form in frontmatter, so a
// registry would drift).
export function tagSlug(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

export function resolveTag(
  slug: string,
  posts: CollectionEntry<'blog'>[]
): string | undefined {
  return posts.find((p) => tagSlug(p.data.tag) === slug)?.data.tag
}
