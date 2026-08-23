import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

import browserCollections from 'collections/browser'
import { useFumadocsLoader } from 'fumadocs-core/source/client'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page'
import { Suspense } from 'react'
import { getMDXComponents } from '@/components/mdx'
import { SidebarFooter } from '@/components/sidebar-footer'
import { legacyDocsPath } from '@/lib/canonical-path'
import { baseOptions } from '@/lib/layout.shared'
import { gitConfig, siteUrl } from '@/lib/shared'
import { getPageImage, slugsToMarkdownPath, source } from '@/lib/source'

export const Route = createFileRoute('/$')({
  component: Page,
  loader: async ({ params }) => {
    // Filter out empty segments so root path ('') maps to index slug ([]).
    const slugs = (params._splat?.split('/') ?? []).filter(Boolean)
    const data = await serverLoader({ data: slugs })
    await clientLoader.preload(data.path)
    return data
  },
  // Per-page title/description/canonical/OG — overrides __root.tsx's
  // site-wide defaults (TanStack Router dedupes `title`/`meta` by
  // name/property, leaf route wins). Falls back to the generic copy for any
  // field frontmatter doesn't set.
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { title, description, canonicalUrl, ogImageUrl } = loaderData
    const ogImage = `${siteUrl}${ogImageUrl}`
    return {
      meta: [
        ...(title
          ? [
              { title: `${title} | chmonitor docs` },
              { property: 'og:title', content: title },
              { name: 'twitter:title', content: title },
            ]
          : []),
        { property: 'og:url', content: canonicalUrl },
        { property: 'og:image', content: ogImage },
        { name: 'twitter:image', content: ogImage },
        ...(description
          ? [
              { name: 'description', content: description },
              { property: 'og:description', content: description },
              { name: 'twitter:description', content: description },
            ]
          : []),
        { name: 'robots', content: 'index, follow' },
      ],
      links: [{ rel: 'canonical', href: canonicalUrl }],
    }
  },
})

const serverLoader = createServerFn({ method: 'GET' })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs)
    if (!page) {
      // Old flat URL? Permanently redirect to its new home under a tab.
      const target = legacyDocsPath(`/${slugs.join('/')}`)
      if (target && source.getPage(target.split('/').filter(Boolean))) {
        throw redirect({ href: target, statusCode: 301 })
      }
      throw notFound()
    }
    return {
      path: page.path,
      markdownUrl: slugsToMarkdownPath(page.slugs).url,
      ogImageUrl: getPageImage(page).url,
      pageTree: await source.serializePageTree(source.getPageTree()),
      title: page.data.title,
      description: page.data.description,
      canonicalUrl: `${siteUrl}${page.url}`,
    }
  })

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: MDX },
    { markdownUrl, path }: { markdownUrl: string; path: string }
  ) {
    return (
      <DocsPage toc={toc}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <div
          data-article-actions
          className="flex flex-row flex-wrap items-center gap-2 border-b -mt-4 pb-6"
        >
          <MarkdownCopyButton
            markdownUrl={markdownUrl}
            className="max-md:min-h-11"
          />
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/docs/content/${path}`}
            className="max-md:min-h-11 max-md:min-w-11"
          />
        </div>
        <DocsBody>
          <MDX components={getMDXComponents()} />
        </DocsBody>
      </DocsPage>
    )
  },
})

function Page() {
  const { path, pageTree, markdownUrl } = useFumadocsLoader(
    Route.useLoaderData()
  )
  return (
    <DocsLayout
      {...baseOptions()}
      tree={pageTree}
      // Sections are switched with Fumadocs' built-in sidebar tabs dropdown,
      // auto-generated from the `root: true` folders — the single section
      // switcher. tabMode stays default ('auto') so it renders inside the
      // sidebar and keeps the tree scoped to the active section. Version lives
      // once in the footer; no custom banner so the sidebar stays compact.
      // `links` is cleared here (kept on HomeLayout's navbar via baseOptions)
      // — DocsLayout renders it a second time in the sidebar, duplicating the
      // section dropdown above with the same 4 links.
      links={[]}
      sidebar={{
        footer: <SidebarFooter />,
      }}
    >
      <Suspense>
        {clientLoader.useContent(path, { markdownUrl, path })}
      </Suspense>
    </DocsLayout>
  )
}
