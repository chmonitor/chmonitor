import { FlaskConical } from 'lucide-react'

import type { ReactNode } from 'react'

import { AddAnotherHostButton } from './add-another-host-button'
import { Badge } from '@/components/ui/badge'

interface ExamplePreviewChromeProps {
  footnote?: string
  children: ReactNode
}

/**
 * Shared one-host compare chrome: Example badge, Add another host (opens the
 * existing connection dialog), and a labeled sample of the real page.
 */
export function ExamplePreviewChrome({
  footnote = 'Sample layout with placeholder names — not live cluster data.',
  children,
}: ExamplePreviewChromeProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
            <FlaskConical
              className="size-4 text-muted-foreground"
              strokeWidth={1.5}
            />
            Example
          </span>
          <Badge variant="secondary" className="font-normal text-[10px]">
            Sample
          </Badge>
          <p className="text-sm text-muted-foreground">{footnote}</p>
        </div>
        <AddAnotherHostButton />
      </div>
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-4">
        {children}
      </div>
    </div>
  )
}
