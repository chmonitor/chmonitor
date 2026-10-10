import type { ReactNode } from 'react'

// Article header, matching the blog post header: mono pill eyebrow with the
// top-level section, a large light h1, the description as a lede, and a meta
// row (reading time, optional updated date). `children` is the action row.
export function DocHero({
  section,
  title,
  description,
  minutes,
  updated,
  children,
}: {
  section?: string
  title: string
  description?: string
  minutes: number
  updated?: string
  children?: ReactNode
}) {
  const updatedLabel = formatDate(updated)
  return (
    <header data-doc-hero className="pt-2">
      {section ? <span className="doc-eyebrow">{section}</span> : null}
      <h1 className="mt-5 text-balance font-normal text-[clamp(1.5rem,4.4vw,2.75rem)] leading-[1.06] tracking-tight text-fd-foreground">
        {title}
      </h1>
      {description ? (
        <p className="mt-4 text-pretty text-lg leading-relaxed text-fd-muted-foreground">
          {description}
        </p>
      ) : null}
      <div className="mt-5 mb-6 flex flex-wrap items-center gap-2.5 text-sm text-fd-muted-foreground">
        <span>{minutes} min read</span>
        {updatedLabel ? (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={updated}>Updated {updatedLabel}</time>
          </>
        ) : null}
      </div>
      {children}
    </header>
  )
}

function formatDate(value?: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
