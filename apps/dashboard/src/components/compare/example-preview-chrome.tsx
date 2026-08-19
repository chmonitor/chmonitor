import { FlaskConical } from 'lucide-react'

import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'

interface ExamplePreviewChromeProps {
  footnote?: string
  children: ReactNode
}

/**
 * Faded sample of TableList + DdlPair (or similar) under a real empty state.
 * Deterministic placeholder names — not live cluster data.
 */
export function ExamplePreviewChrome({
  footnote = 'Sample layout with placeholder names — not live cluster data.',
  children,
}: ExamplePreviewChromeProps) {
  return (
    <div className="flex flex-col gap-3">
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
      <div
        className="pointer-events-none select-none rounded-xl border border-dashed border-border bg-card/40 p-4 opacity-40"
        aria-hidden="true"
        data-testid="compare-example-preview"
      >
        {children}
      </div>
    </div>
  )
}
