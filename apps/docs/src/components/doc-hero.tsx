import type { ReactNode } from 'react'

// Article header, matching the blog post header: a quiet section eyebrow, a
// large light h1, the description as a lede, then one row holding the page
// actions (`children`) and the meta (reading time, optional updated date).
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
      {section ? <p className="doc-eyebrow">{section}</p> : null}
      <h1 className="mt-3 text-balance font-normal text-[clamp(1.5rem,4.4vw,2.75rem)] leading-[1.06] tracking-tight text-fd-foreground">
        {title}
      </h1>
      {description ? (
        <p className="mt-4 text-pretty text-base leading-relaxed sm:text-lg text-fd-muted-foreground">
          {description}
        </p>
      ) : null}
      <div className="mt-6 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-6 text-sm text-fd-muted-foreground">
        {children}
        <span>{minutes} min read</span>
        {updatedLabel ? (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={updated}>Updated {updatedLabel}</time>
          </>
        ) : null}
      </div>
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
