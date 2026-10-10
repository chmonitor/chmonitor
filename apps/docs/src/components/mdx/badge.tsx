import type { ReactNode } from 'react'

export type BadgeVariant = 'version-added' | 'cloud' | 'experimental'

export interface BadgeProps {
  variant: BadgeVariant
  /** For `version-added`: the version, e.g. "0.3". */
  version?: string
  children?: ReactNode
}

// Brand vars may not exist yet; each falls back to the Fumadocs primary.
// Written as literal strings so Tailwind's scanner picks them up.
const STYLES: Record<BadgeVariant, string> = {
  'version-added': 'border-fd-border bg-fd-muted text-fd-muted-foreground',
  cloud:
    'border-[color-mix(in_oklab,var(--brand,var(--color-fd-primary))_40%,transparent)] bg-[color-mix(in_oklab,var(--brand,var(--color-fd-primary))_12%,transparent)] text-[var(--brand-ink,var(--color-fd-primary))]',
  experimental:
    'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
}

export function badgeLabel(variant: BadgeVariant, version?: string): string {
  if (variant === 'version-added')
    return version ? `Added in v${version.replace(/^v/, '')}` : 'New'
  if (variant === 'cloud') return 'Cloud'
  return 'Experimental'
}

export function Badge({ variant, version, children }: BadgeProps) {
  return (
    <span
      data-variant={variant}
      className={`not-prose inline-flex items-center rounded-full border px-2 py-0.5 align-middle text-[11px] leading-4 font-medium whitespace-nowrap ${STYLES[variant]}`}
    >
      {children ?? badgeLabel(variant, version)}
    </span>
  )
}
