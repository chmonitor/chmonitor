import { useShowNewBadge } from '../hooks/use-visited-pages'

interface NewBadgeProps {
  href: string
  isNew?: boolean
}

export const NewBadge = function NewBadge({ href, isNew }: NewBadgeProps) {
  const showBadge = useShowNewBadge(href, isNew)

  if (!showBadge) return null

  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] max-sm:text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
      New
    </span>
  )
}
