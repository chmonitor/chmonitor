import { ArrowRightIcon } from '@radix-ui/react-icons'
import type { Row, RowData } from '@tanstack/react-table'

import { AppLink as Link } from '@/components/ui/app-link'
import { replaceTemplateVariables } from '@/lib/template-utils'
import { cn } from '@/lib/utils'

export interface LinkFormatOptions {
  href?: string
  className?: string
  title?: string
  [key: string]: unknown
}

interface LinkFormatProps<
  TData extends RowData,
  TValue extends React.ReactNode,
> {
  row: Row<TData>
  data: TData[]
  value: TValue
  context: Record<string, string>
  options?: LinkFormatOptions
}

function LinkFormatComponent<
  TData extends RowData,
  TValue extends React.ReactNode,
>({ row, data, value, context, options }: LinkFormatProps<TData, TValue>) {
  const { href: rawHref, className, ...rest } = options ?? {}

  // No href provided, return value as is
  if (!rawHref) return value

  // No label — an empty link has no accessible name and a dead href
  if (value == null || String(value).trim() === '') return value

  // Normalize href to string (may be string, URL, or UrlObject)
  const href = typeof rawHref === 'string' ? rawHref : String(rawHref)

  const originalRow = data[row.index] as Record<string, string | undefined>
  const mappingKeyValue = {
    ...originalRow,
    ...context,
  }

  // Href contains placeholders, e.g. /database/[database]/[table]
  // Replace placeholders with values from the row
  const hrefBinding = replaceTemplateVariables(href, mappingKeyValue)

  return (
    <Link
      href={hrefBinding}
      className={cn(
        'group inline-flex flex-row items-center gap-1 transition-colors',
        'text-foreground hover:text-primary',
        className
      )}
      {...rest}
    >
      <span className="truncate">{value}</span>
      <ArrowRightIcon
        className="size-3 flex-none text-transparent transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-current"
        aria-hidden="true"
      />
    </Link>
  )
}

export const LinkFormat = LinkFormatComponent as typeof LinkFormatComponent & {
  displayName?: string
}
