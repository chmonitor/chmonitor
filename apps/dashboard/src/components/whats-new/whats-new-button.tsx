import { Newspaper } from 'lucide-react'

import { IconButton } from '@/components/ui/icon-button'
import { useWhatsNew } from '@/components/whats-new/whats-new-provider'
import { cn } from '@/lib/utils'

interface WhatsNewButtonProps {
  onClick?: () => void
  hasUnseen?: boolean
}

export function WhatsNewButton({
  onClick,
  hasUnseen: hasUnseenProp,
}: WhatsNewButtonProps) {
  const ctx = useWhatsNew()
  const open = onClick ?? ctx.open
  const hasUnseen = hasUnseenProp ?? ctx.hasUnseen

  return (
    <div className="relative shrink-0">
      <IconButton
        tooltip="What's new"
        tooltipSide="right"
        icon={<Newspaper className="size-4" strokeWidth={1.5} />}
        onClick={open}
        aria-label="What's new"
        data-testid="whats-new-button"
        className="min-h-11 min-w-11 shrink-0 lg:min-h-8 lg:min-w-8"
      />
      {hasUnseen ? (
        <span
          data-testid="whats-new-badge"
          aria-hidden="true"
          className={cn(
            'absolute top-1.5 right-1.5 size-2 rounded-full bg-primary lg:top-1 lg:right-1'
          )}
        />
      ) : null}
    </div>
  )
}
