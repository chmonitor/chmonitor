/**
 * Open Graph cards for blog.chmonitor.dev.
 *
 * Shared compositor (scripts/og-builder.ts): paper dune plate, title centered,
 * logo bottom-right so the post / version title is the hero.
 *
 *   cd apps/blog && bun run scripts/build-og.ts
 */

import { writeOgCard } from '../../../scripts/og-builder'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fontsDir = join(here, 'og-fonts')
const contentDir = join(here, '..', 'src', 'content', 'blog')
const fonts = [
  'inter-400',
  'inter-500',
  'inter-600',
  'inter-700',
  'jbm-500',
  'jbm-600',
].map((f) => join(fontsDir, `${f}.ttf`))

function parseFrontmatter(src: string): Record<string, string> {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return {}
  const data: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (!kv) continue
    let value = kv[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    data[kv[1]] = value
  }
  return data
}

await mkdir(join(here, '..', 'public', 'og', 'blog'), { recursive: true })

await writeOgCard(
  {
    out: 'apps/blog/public/og/blog/index.png',
    eyebrow: 'BLOG',
    title: "What's new in\nchmonitor",
    sub: 'Release notes, product updates, and operating ClickHouse.',
    domain: 'blog.chmonitor.dev',
    plate: 'landing',
    ink: 'light',
    logo: 'bottom-right',
  },
  { fonts }
)

const files = (await readdir(contentDir)).filter((f) => f.endsWith('.md'))
for (const file of files) {
  const src = await readFile(join(contentDir, file), 'utf-8')
  const fm = parseFrontmatter(src)
  if (fm.draft === 'true') continue
  if (!fm.title) {
    console.warn(`[build-og] skipping ${file} — no title in frontmatter`)
    continue
  }
  const slug = fm.version ?? file.replace(/\.md$/, '')
  const version = fm.version
  const eyebrow = version
    ? `RELEASE · ${version}`
    : `BLOG · ${fm.tag ?? 'Post'}`
  await writeOgCard(
    {
      out: `apps/blog/public/og/blog/${slug}.png`,
      eyebrow,
      title: fm.title,
      domain: 'blog.chmonitor.dev',
      plate: 'landing',
      ink: 'light',
      logo: 'bottom-right',
    },
    { fonts }
  )
}
console.log('done')
