import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

// Blog posts live as Markdown in src/content/blog/*.md. The content-layer
// `glob` loader picks them up; frontmatter is validated by the schema below.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tag: z.string().default('Release'),
    version: z.string().optional(),
    cover: z.string().optional(),
    author: z.string().optional(),
    draft: z.boolean().default(false),
  }),
})

export const collections = { blog }
