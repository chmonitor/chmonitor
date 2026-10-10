import type { ReactNode } from 'react'

import { Badge, type BadgeVariant } from './badge'
import { Card } from 'fumadocs-ui/components/card'

export interface FeatureCardProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  href?: string
  badge?: BadgeVariant
  badgeVersion?: string
  children?: ReactNode
}

/**
 * Fumadocs <Card> with an icon and an optional Badge in the title row. The
 * hover border uses --brand when app.css defines it, else the Fumadocs
 * primary, so it renders correctly before the brand tokens land.
 */
export function FeatureCard({
  title,
  description,
  icon,
  href,
  badge,
  badgeVersion,
  children,
}: FeatureCardProps) {
  return (
    <Card
      href={href}
      icon={icon}
      description={description}
      className="transition-colors hover:border-[var(--brand,var(--color-fd-primary))] [&_svg]:transition-colors hover:[&_svg]:text-[var(--brand,var(--color-fd-primary))]"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {title}
          {badge ? <Badge variant={badge} version={badgeVersion} /> : null}
        </span>
      }
    >
      {children}
    </Card>
  )
}
