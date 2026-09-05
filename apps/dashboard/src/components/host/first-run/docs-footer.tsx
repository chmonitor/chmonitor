import { docsSiteUrl } from '@/lib/docs-site'

export function DocsFooter({
  links,
}: {
  links: { slug: string; label: string }[]
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {links.map(({ slug, label }) => (
        <a
          key={slug}
          href={docsSiteUrl(slug)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-muted"
        >
          {label}
        </a>
      ))}
    </div>
  )
}
